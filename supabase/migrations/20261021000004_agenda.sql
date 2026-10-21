-- =====================================================================
-- Salon OS · 004 · Agenda
-- Um agendamento tem 1+ itens (serviços em sequência). Cada item tem seu
-- profissional e horário. A trava de sobreposição fica NO BANCO, por item.
-- =====================================================================

create type public.appointment_status as enum (
  'agendado', 'confirmado', 'em_atendimento', 'concluido', 'nao_compareceu', 'cancelado', 'reagendado'
);
create type public.appointment_origin as enum ('recepcao', 'link_online', 'whatsapp', 'profissional');

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  status public.appointment_status not null default 'agendado',
  origin public.appointment_origin not null default 'recepcao',
  notes text,
  -- mantidos por trigger a partir dos itens
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  rescheduled_from_id uuid references public.appointments(id),
  rescheduled_to_id uuid references public.appointments(id),
  cancel_reason text,
  confirmed_at timestamptz,
  checked_in_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_salon_start_idx on public.appointments(salon_id, starts_at);
create index appointments_client_idx on public.appointments(client_id, starts_at desc);
create trigger trg_appointments_updated before update on public.appointments
  for each row execute function public.set_updated_at();

create table public.appointment_items (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  service_id uuid not null references public.services(id),
  professional_id uuid not null references public.professionals(id),
  position smallint not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price numeric(10,2) not null default 0 check (price >= 0),
  is_squeeze boolean not null default false,       -- "encaixe": ignora jornada e sobreposição
  occupies boolean not null default true,          -- false quando o agendamento é cancelado/reagendado
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint appointment_items_no_overlap exclude using gist (
    professional_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (occupies and not is_squeeze)
);
create index appointment_items_appt_idx on public.appointment_items(appointment_id, position);
create index appointment_items_prof_idx on public.appointment_items(professional_id, starts_at);

alter table public.client_notes
  add constraint client_notes_appointment_fk foreign key (appointment_id) references public.appointments(id) on delete set null;
alter table public.client_photos
  add constraint client_photos_appointment_fk foreign key (appointment_id) references public.appointments(id) on delete set null;

-- ---------------------------------------------------------------------
-- Lista de espera
-- ---------------------------------------------------------------------
create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  service_id uuid references public.services(id),
  professional_id uuid references public.professionals(id),   -- nulo = qualquer profissional
  date_from date not null default current_date,
  date_to date,
  period text not null default 'qualquer' check (period in ('manha', 'tarde', 'noite', 'qualquer')),
  notes text,
  status text not null default 'aguardando' check (status in ('aguardando', 'agendado', 'desistiu')),
  appointment_id uuid references public.appointments(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (date_to is null or date_to >= date_from)
);
create index waitlist_salon_idx on public.waitlist(salon_id, status);

-- ---------------------------------------------------------------------
-- Auditoria (agendamentos agora; comandas, caixa e estoque na Fase 2)
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  salon_id uuid not null references public.salons(id) on delete cascade,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log(table_name, record_id, changed_at desc);

create or replace function public.write_audit_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (salon_id, table_name, record_id, action, old_data, new_data, changed_by)
  values (
    (v_row ->> 'salon_id')::uuid,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end,
    auth.uid()
  );
  return coalesce(new, old);
end $$;

create trigger trg_audit_appointments after insert or update or delete on public.appointments
  for each row execute function public.write_audit_log();
create trigger trg_audit_appointment_items after insert or update or delete on public.appointment_items
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------
-- Regras da agenda
-- ---------------------------------------------------------------------

-- Itens e agendamento precisam ser do mesmo salão (cliente, serviço, profissional)
create or replace function public.assert_item_same_salon()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.appointments where id = new.appointment_id and salon_id = new.salon_id)
     or not exists (select 1 from public.services where id = new.service_id and salon_id = new.salon_id)
     or not exists (select 1 from public.professionals where id = new.professional_id and salon_id = new.salon_id) then
    raise exception 'Referência de outro salão';
  end if;
  return new;
end $$;
create trigger trg_items_same_salon before insert or update on public.appointment_items
  for each row execute function public.assert_item_same_salon();

create trigger trg_appointments_client_same_salon before insert or update of client_id on public.appointments
  for each row execute function public.assert_client_same_salon();
create trigger trg_waitlist_client_same_salon before insert or update of client_id on public.waitlist
  for each row execute function public.assert_client_same_salon();

-- Jornada e bloqueios. Mensagens com prefixo para o front oferecer "encaixe".
create or replace function public.check_item_schedule()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_has_hours boolean;
  v_block record;
begin
  if new.is_squeeze or not new.occupies then
    return new;
  end if;
  -- só valida mudanças de horário/profissional (mudar status não revalida o passado)
  if tg_op = 'UPDATE'
     and new.starts_at = old.starts_at and new.ends_at = old.ends_at
     and new.professional_id = old.professional_id and old.occupies = new.occupies then
    return new;
  end if;

  select timezone into v_tz from public.salons where id = new.salon_id;
  v_local_start := new.starts_at at time zone v_tz;
  v_local_end := new.ends_at at time zone v_tz;

  -- Jornada: só vale se o profissional tiver jornada cadastrada
  select exists (select 1 from public.professional_hours where professional_id = new.professional_id)
    into v_has_hours;
  if v_has_hours then
    if v_local_start::date <> (v_local_end - interval '1 microsecond')::date
       or not exists (
         select 1 from public.professional_hours h
         where h.professional_id = new.professional_id
           and h.weekday = extract(isodow from v_local_start)
           and h.start_time <= v_local_start::time
           and h.end_time >= v_local_end::time
       ) then
      raise exception 'FORA_DA_JORNADA: horário fora da jornada do profissional'
        using errcode = 'P0001', hint = 'Use "encaixe" para marcar mesmo assim.';
    end if;
  end if;

  select b.kind, b.reason into v_block
  from public.schedule_blocks b
  where b.salon_id = new.salon_id
    and (b.professional_id is null or b.professional_id = new.professional_id)
    and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
  limit 1;
  if found then
    raise exception 'BLOQUEIO: horário bloqueado (%)', coalesce(v_block.reason, v_block.kind::text)
      using errcode = 'P0001', hint = 'Use "encaixe" para marcar mesmo assim.';
  end if;

  return new;
end $$;
create trigger trg_items_schedule before insert or update on public.appointment_items
  for each row execute function public.check_item_schedule();

-- Mantém início/fim do agendamento = min/max dos itens
create or replace function public.sync_appointment_bounds()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(new.appointment_id, old.appointment_id);
begin
  update public.appointments a
     set starts_at = b.s, ends_at = b.e
    from (select min(starts_at) s, max(ends_at) e from public.appointment_items where appointment_id = v_id) b
   where a.id = v_id and b.s is not null
     and (a.starts_at is distinct from b.s or a.ends_at is distinct from b.e);
  return null;
end $$;
create trigger trg_items_bounds after insert or update or delete on public.appointment_items
  for each row execute function public.sync_appointment_bounds();

-- Status → carimbos de data e liberação do horário
create or replace function public.on_appointment_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'confirmado' then new.confirmed_at := coalesce(new.confirmed_at, now());
      when 'em_atendimento' then new.checked_in_at := coalesce(new.checked_in_at, now());
      when 'concluido' then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelado' then new.cancelled_at := coalesce(new.cancelled_at, now());
      else null;
    end case;
  end if;
  return new;
end $$;
create trigger trg_appointment_status before update of status on public.appointments
  for each row execute function public.on_appointment_status();

create or replace function public.sync_items_occupancy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.appointment_items
       set occupies = new.status not in ('cancelado', 'reagendado')
     where appointment_id = new.id
       and occupies is distinct from (new.status not in ('cancelado', 'reagendado'));
  end if;
  return null;
end $$;
create trigger trg_appointment_occupancy after update of status on public.appointments
  for each row execute function public.sync_items_occupancy();

-- Profissional vê clientes que já atendeu ou tem marcados
create or replace function public.professional_can_see_client(p_salon_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.appointments a
    join public.appointment_items i on i.appointment_id = a.id
    where a.salon_id = p_salon_id
      and a.client_id = p_client_id
      and i.professional_id = public.my_professional_id(p_salon_id)
  )
$$;

create or replace function public.professional_in_appointment(p_appointment_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.appointment_items i
    where i.appointment_id = p_appointment_id
      and i.professional_id = public.my_professional_id(i.salon_id)
  )
$$;

-- ---------------------------------------------------------------------
-- RPCs (security invoker: valem as policies de quem chama)
-- ---------------------------------------------------------------------

-- Cria agendamento + itens numa transação.
-- p_items: [{service_id, professional_id, starts_at?, duration_minutes?, price?, is_squeeze?}]
-- Item sem starts_at começa quando o anterior termina.
create or replace function public.create_appointment(
  p_salon_id uuid,
  p_client_id uuid,
  p_items jsonb,
  p_origin public.appointment_origin default 'recepcao',
  p_notes text default null,
  p_status public.appointment_status default 'agendado'
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_appt uuid;
  v_item jsonb;
  v_pos int := 0;
  v_cursor timestamptz;
  v_start timestamptz;
  v_duration int;
  v_price numeric(10,2);
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha pelo menos um serviço';
  end if;
  if p_status not in ('agendado', 'confirmado') then
    raise exception 'Status inicial inválido';
  end if;

  v_cursor := (p_items -> 0 ->> 'starts_at')::timestamptz;
  if v_cursor is null then
    raise exception 'Informe o horário do primeiro serviço';
  end if;

  insert into public.appointments (salon_id, client_id, status, origin, notes, starts_at, ends_at, created_by)
  values (p_salon_id, p_client_id, p_status, p_origin, p_notes, v_cursor, v_cursor + interval '1 minute', auth.uid())
  returning id into v_appt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select
      coalesce((v_item ->> 'duration_minutes')::int, ps.duration_minutes, s.duration_minutes),
      coalesce((v_item ->> 'price')::numeric, ps.price, s.price)
    into v_duration, v_price
    from public.services s
    left join public.professional_services ps
      on ps.service_id = s.id and ps.professional_id = (v_item ->> 'professional_id')::uuid
    where s.id = (v_item ->> 'service_id')::uuid and s.salon_id = p_salon_id and s.active;
    if v_duration is null then
      raise exception 'Serviço inválido ou inativo';
    end if;

    v_start := coalesce((v_item ->> 'starts_at')::timestamptz, v_cursor);
    insert into public.appointment_items
      (salon_id, appointment_id, service_id, professional_id, position, starts_at, ends_at, price, is_squeeze)
    values (
      p_salon_id, v_appt, (v_item ->> 'service_id')::uuid, (v_item ->> 'professional_id')::uuid, v_pos,
      v_start, v_start + make_interval(mins => v_duration), v_price,
      coalesce((v_item ->> 'is_squeeze')::boolean, false)
    );
    v_cursor := v_start + make_interval(mins => v_duration);
    v_pos := v_pos + 1;
  end loop;

  return v_appt;
end $$;

-- Remarca: o original vira "reagendado" e nasce um novo agendamento no novo horário.
-- Todos os itens se deslocam juntos. p_professional_id troca o profissional de todos os itens.
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_start timestamptz,
  p_professional_id uuid default null,
  p_is_squeeze boolean default false
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  a public.appointments;
  v_new uuid;
  v_delta interval;
begin
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;
  if a.status in ('concluido', 'cancelado', 'reagendado', 'em_atendimento') then
    raise exception 'Este agendamento não pode ser remarcado (status %)', a.status;
  end if;
  v_delta := p_new_start - a.starts_at;

  update public.appointments set status = 'reagendado' where id = a.id;

  insert into public.appointments (salon_id, client_id, status, origin, notes, starts_at, ends_at, rescheduled_from_id, created_by)
  values (a.salon_id, a.client_id, 'agendado', a.origin, a.notes, a.starts_at + v_delta, a.ends_at + v_delta, a.id, auth.uid())
  returning id into v_new;

  insert into public.appointment_items
    (salon_id, appointment_id, service_id, professional_id, position, starts_at, ends_at, price, is_squeeze)
  select salon_id, v_new, service_id, coalesce(p_professional_id, professional_id), position,
         starts_at + v_delta, ends_at + v_delta, price, p_is_squeeze or is_squeeze
  from public.appointment_items where appointment_id = a.id
  order by position;

  update public.appointments set rescheduled_to_id = v_new where id = a.id;
  return v_new;
end $$;

-- Muda status. Recepção/admin: qualquer status (exceto reagendado, que é via remarcar).
-- Profissional: só nos próprios atendimentos e só confirmado/em atendimento/concluído/não compareceu.
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status public.appointment_status,
  p_reason text default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  a public.appointments;
begin
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;
  if p_status = 'reagendado' then
    raise exception 'Use remarcar para mudar o horário';
  end if;
  if a.status = 'reagendado' then
    raise exception 'Agendamento já remarcado; altere o novo horário';
  end if;
  if not (
    public.is_salon_staff(a.salon_id)
    or (public.salon_role_of(a.salon_id) = 'profissional'
        and public.professional_in_appointment(a.id)
        and p_status in ('confirmado', 'em_atendimento', 'concluido', 'nao_compareceu'))
  ) then
    raise exception 'Sem permissão para alterar este agendamento' using errcode = '42501';
  end if;
  update public.appointments
     set status = p_status,
         cancel_reason = case when p_status = 'cancelado' then p_reason else cancel_reason end
   where id = a.id;
end $$;

-- Sugestões da lista de espera para o horário liberado por um agendamento
create or replace function public.waitlist_suggestions(p_appointment_id uuid)
returns table (
  waitlist_id uuid, client_id uuid, client_name text, client_phone text,
  service_id uuid, professional_id uuid, period text, notes text, created_at timestamptz
) language sql stable security invoker set search_path = public as $$
  with freed as (
    select a.salon_id, (a.starts_at at time zone s.timezone)::date as day,
           extract(hour from a.starts_at at time zone s.timezone) as hour,
           array_agg(i.service_id) as services, array_agg(i.professional_id) as professionals
    from public.appointments a
    join public.salons s on s.id = a.salon_id
    join public.appointment_items i on i.appointment_id = a.id
    where a.id = p_appointment_id
    group by a.salon_id, a.starts_at, s.timezone
  )
  select w.id, w.client_id, c.name, c.phone, w.service_id, w.professional_id, w.period, w.notes, w.created_at
  from public.waitlist w
  join freed f on f.salon_id = w.salon_id
  join public.clients c on c.id = w.client_id
  where w.status = 'aguardando'
    and c.archived_at is null
    and f.day >= w.date_from
    and (w.date_to is null or f.day <= w.date_to)
    and (w.service_id is null or w.service_id = any(f.services))
    and (w.professional_id is null or w.professional_id = any(f.professionals))
    and (w.period = 'qualquer'
         or (w.period = 'manha' and f.hour < 12)
         or (w.period = 'tarde' and f.hour >= 12 and f.hour < 18)
         or (w.period = 'noite' and f.hour >= 18))
    and not exists (
      select 1 from public.appointments a2
      where a2.client_id = w.client_id and a2.starts_at > now()
        and a2.status in ('agendado', 'confirmado')
    )
  order by w.created_at
  limit 10
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.appointments enable row level security;
alter table public.appointment_items enable row level security;
alter table public.waitlist enable row level security;
alter table public.audit_log enable row level security;

create policy appointments_select on public.appointments for select to authenticated
  using (public.is_salon_staff(salon_id) or public.professional_in_appointment(id));
create policy appointments_insert on public.appointments for insert to authenticated
  with check (public.is_salon_staff(salon_id));
create policy appointments_update on public.appointments for update to authenticated
  using (public.is_salon_staff(salon_id)) with check (public.is_salon_staff(salon_id));
-- sem delete: cancelar

create policy items_select on public.appointment_items for select to authenticated
  using (
    public.is_salon_staff(salon_id)
    or professional_id = public.my_professional_id(salon_id)
  );
create policy items_insert on public.appointment_items for insert to authenticated
  with check (public.is_salon_staff(salon_id));
create policy items_update on public.appointment_items for update to authenticated
  using (public.is_salon_staff(salon_id)) with check (public.is_salon_staff(salon_id));
create policy items_delete on public.appointment_items for delete to authenticated
  using (public.is_salon_staff(salon_id));

create policy waitlist_all on public.waitlist for all to authenticated
  using (public.is_salon_staff(salon_id)) with check (public.is_salon_staff(salon_id));

create policy audit_select on public.audit_log for select to authenticated
  using (public.is_salon_admin(salon_id));

-- ---------------------------------------------------------------------
-- Visão de clientes com indicadores (RLS do chamador vale: security_invoker)
-- Status: perdido (manual) · novo · agendado · ativo (≤60d) · em_risco (61–120d) · inativo (>120d)
-- ---------------------------------------------------------------------
create or replace view public.client_overview with (security_invoker = true) as
with done as (
  select a.client_id, a.starts_at, sum(i.price) as amount
  from public.appointments a
  join public.appointment_items i on i.appointment_id = a.id
  where a.status = 'concluido'
  group by a.id, a.client_id, a.starts_at
),
agg as (
  select client_id,
         count(*) as visits_count,
         max(starts_at) as last_visit_at,
         min(starts_at) as first_visit_at,
         sum(amount) as total_spent
  from done group by client_id
),
nxt as (
  select client_id, min(starts_at) as next_appointment_at
  from public.appointments
  where status in ('agendado', 'confirmado') and starts_at >= now()
  group by client_id
),
ret as (
  -- última vez de cada serviço com intervalo de retorno → próxima data prevista
  select client_id, min(due) as next_return_at
  from (
    select a.client_id, i.service_id, max(i.starts_at) + make_interval(days => max(s.return_interval_days)) as due
    from public.appointments a
    join public.appointment_items i on i.appointment_id = a.id
    join public.services s on s.id = i.service_id
    where a.status = 'concluido' and s.return_interval_days is not null
    group by a.client_id, i.service_id
  ) x group by client_id
)
select
  c.*,
  coalesce(agg.visits_count, 0) as visits_count,
  agg.last_visit_at,
  agg.total_spent,
  case when agg.visits_count > 1
       then round(extract(epoch from (agg.last_visit_at - agg.first_visit_at)) / 86400 / (agg.visits_count - 1))
  end as avg_frequency_days,
  nxt.next_appointment_at,
  ret.next_return_at,
  case
    when c.lost_at is not null then 'perdido'
    when agg.visits_count is null and nxt.next_appointment_at is not null then 'agendado'
    when agg.visits_count is null then 'novo'
    when nxt.next_appointment_at is not null or agg.last_visit_at >= now() - interval '60 days' then 'ativo'
    when agg.last_visit_at >= now() - interval '120 days' then 'em_risco'
    else 'inativo'
  end as lifecycle_status
from public.clients c
left join agg on agg.client_id = c.id
left join nxt on nxt.client_id = c.id
left join ret on ret.client_id = c.id;

grant select on public.client_overview to authenticated;

revoke execute on function public.set_appointment_status(uuid, public.appointment_status, text) from public, anon;
grant execute on function public.set_appointment_status(uuid, public.appointment_status, text) to authenticated;
