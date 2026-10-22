-- =====================================================================
-- Salon OS · 012 · Dashboard, Marketing & Vendas e Inteligência
-- Tudo calculado no banco, no fuso do salão, com o período anterior para
-- comparação. Valores financeiros só para o administrador.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ocupação: a jornada de cada profissional em fatias de 15 minutos.
-- Cada fatia sabe se está bloqueada (folga, férias, feriado) e se tem
-- atendimento marcado (inclui quem faltou: o horário estava reservado).
-- Interna: só as funções abaixo chamam.
-- ---------------------------------------------------------------------
create or replace function public.occupancy_ticks(p_salon_id uuid, p_from date, p_to date)
returns table (professional_id uuid, at timestamptz, blocked boolean, booked boolean)
language sql stable security definer set search_path = public as $$
  with sl as (select timezone from public.salons where id = p_salon_id)
  select h.professional_id, t.at,
         exists (select 1 from public.schedule_blocks b
                 where b.salon_id = p_salon_id
                   and (b.professional_id is null or b.professional_id = h.professional_id)
                   and tstzrange(b.starts_at, b.ends_at) @> t.at) as blocked,
         exists (select 1 from public.appointment_items i
                 where i.professional_id = h.professional_id and i.occupies
                   and i.starts_at <= t.at and i.starts_at > t.at - interval '12 hours'
                   and t.at < i.ends_at) as booked
  from sl
  cross join generate_series(p_from, p_to, interval '1 day') d(day)
  join public.professional_hours h on h.salon_id = p_salon_id and h.weekday = extract(isodow from d.day)
  join public.professionals p on p.id = h.professional_id and p.active
  cross join lateral generate_series(
    (d.day::date + h.start_time) at time zone sl.timezone,
    (d.day::date + h.end_time) at time zone sl.timezone - interval '15 minutes',
    interval '15 minutes') t(at)
$$;
revoke execute on function public.occupancy_ticks(uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Dashboard: indicadores de um período (interna)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_period(p_salon_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_revenue numeric;
  v_orders int;
  v_products numeric;
  v_appts int;
  v_attended int;
  v_noshow int;
  v_avail int;
  v_booked int;
  v_new int;
  v_back int;
  v_comm numeric;
begin
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  select coalesce(sum(o.total), 0), count(*) into v_revenue, v_orders
  from public.orders o
  where o.salon_id = p_salon_id and o.status = 'fechada' and o.closed_at >= v_start and o.closed_at < v_end;

  -- produto: valor do item menos a parte proporcional do desconto da comanda
  select coalesce(sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end), 0)
    into v_products
  from public.order_items i join public.orders o on o.id = i.order_id
  where o.salon_id = p_salon_id and o.status = 'fechada' and o.closed_at >= v_start and o.closed_at < v_end
    and i.kind = 'produto';

  select count(*) filter (where status not in ('cancelado', 'reagendado')),
         count(*) filter (where status in ('concluido', 'em_atendimento')),
         count(*) filter (where status = 'nao_compareceu')
    into v_appts, v_attended, v_noshow
  from public.appointments
  where salon_id = p_salon_id and starts_at >= v_start and starts_at < v_end;

  select count(*) filter (where not blocked), count(*) filter (where booked and not blocked)
    into v_avail, v_booked
  from public.occupancy_ticks(p_salon_id, p_from, p_to);

  -- Cliente nova: primeira visita concluída dentro do período.
  -- Voltou: visita no período e outra antes dele.
  with v as (
    select client_id, min(starts_at) as first_at,
           bool_or(starts_at >= v_start and starts_at < v_end) as in_period
    from public.appointments
    where salon_id = p_salon_id and status = 'concluido' and starts_at < v_end
    group by client_id
  )
  select count(*) filter (where first_at >= v_start),
         count(*) filter (where in_period and first_at < v_start)
    into v_new, v_back
  from v where in_period;

  select coalesce(sum(amount), 0) into v_comm
  from public.commissions
  where salon_id = p_salon_id and status <> 'estornada' and competence_date between p_from and p_to;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', v_revenue,
    'orders', v_orders,
    'avg_ticket', case when v_orders > 0 then round(v_revenue / v_orders, 2) end,
    'appointments', v_appts,
    'attended', v_attended,
    'no_shows', v_noshow,
    'attendance_rate', case when v_attended + v_noshow > 0 then round(v_attended::numeric / (v_attended + v_noshow), 4) end,
    'booked_hours', round(v_booked / 4.0, 1),
    'available_hours', round(v_avail / 4.0, 1),
    'occupancy', case when v_avail > 0 then round(v_booked::numeric / v_avail, 4) end,
    'new_clients', v_new,
    'returning_clients', v_back,
    'product_revenue', round(v_products, 2),
    'product_share', case when v_revenue > 0 then round(v_products / v_revenue, 4) end,
    'commissions', v_comm
  );
end $$;
revoke execute on function public.dashboard_period(uuid, date, date) from public, anon, authenticated;

create or replace function public.dashboard_summary(p_salon_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_days int := p_to - p_from + 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_prev_to date := p_from - 1;
  v_weekly boolean := (p_to - p_from + 1) > 62;
  v_series jsonb;
  v_upcoming jsonb;
  v_birthdays jsonb;
  v_today date;
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador vê o dashboard' using errcode = '42501';
  end if;
  if p_to < p_from or v_days > 400 then
    raise exception 'Período inválido (até 400 dias)';
  end if;
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_today := (now() at time zone v_tz)::date;

  -- Faturamento por dia (ou semana, acima de 62 dias). O "anterior" de cada barra soma
  -- os mesmos dias deslocados pelo tamanho do período, então dia e semana se alinham.
  with days as (
    select d::date as d, (case when v_weekly then date_trunc('week', d)::date else d::date end) as bucket
    from generate_series(p_from, p_to, interval '1 day') d
  ), rev as (
    select (o.closed_at at time zone v_tz)::date as d, sum(o.total) as total
    from public.orders o
    where o.salon_id = p_salon_id and o.status = 'fechada'
      and o.closed_at >= (v_prev_from::timestamp at time zone v_tz)
      and o.closed_at < ((p_to + 1)::timestamp at time zone v_tz)
    group by 1
  ), per_bucket as (
    select days.bucket, coalesce(sum(c.total), 0) as cur, coalesce(sum(p.total), 0) as prev
    from days
    left join rev c on c.d = days.d
    left join rev p on p.d = days.d - v_days
    group by days.bucket
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'current', cur, 'previous', prev) order by bucket), '[]'::jsonb)
    into v_series
  from per_bucket;

  select coalesce(jsonb_agg(x order by x ->> 'starts_at'), '[]'::jsonb) into v_upcoming
  from (
    select jsonb_build_object(
             'id', a.id, 'starts_at', a.starts_at, 'status', a.status, 'client_name', c.name,
             'services', (select string_agg(s.name, ' + ' order by i.position) from public.appointment_items i
                          join public.services s on s.id = i.service_id where i.appointment_id = a.id),
             'professional', (select pr.name from public.appointment_items i join public.professionals pr on pr.id = i.professional_id
                              where i.appointment_id = a.id order by i.position limit 1)) as x
    from public.appointments a join public.clients c on c.id = a.client_id
    where a.salon_id = p_salon_id and a.status in ('agendado', 'confirmado') and a.starts_at >= now()
    order by a.starts_at
    limit 8
  ) t;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'date', nb, 'age', age)
                            order by nb, name), '[]'::jsonb)
    into v_birthdays
  from (
    select c.id, c.name, c.phone,
           case when b.this_year < v_today then (b.this_year + interval '1 year')::date else b.this_year end as nb,
           extract(year from age(case when b.this_year < v_today then (b.this_year + interval '1 year')::date else b.this_year end, c.birth_date))::int as age
    from public.clients c
    cross join lateral (
      select (c.birth_date + make_interval(years => (extract(year from v_today) - extract(year from c.birth_date))::int))::date as this_year
    ) b
    where c.salon_id = p_salon_id and c.archived_at is null and c.birth_date is not null
  ) x
  where nb between v_today and v_today + 6;

  return jsonb_build_object(
    'current', public.dashboard_period(p_salon_id, p_from, p_to),
    'previous', public.dashboard_period(p_salon_id, v_prev_from, v_prev_to),
    'granularity', case when v_weekly then 'semana' else 'dia' end,
    'series', v_series,
    'upcoming', v_upcoming,
    'birthdays', v_birthdays
  );
end $$;

-- ---------------------------------------------------------------------
-- Marketing & Vendas: lançamento mensal por canal
-- O canal vem da origem da cliente/lead (Meta Ads, Google, Instagram,
-- Indicação). O que não for lançado à mão é calculado pelos dados.
-- ---------------------------------------------------------------------
create type public.marketing_channel as enum ('meta_ads', 'google', 'instagram', 'indicacao');

create table public.marketing_entries (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  channel public.marketing_channel not null,
  investment numeric(10,2) not null default 0 check (investment >= 0),
  -- nulos = usar o número calculado pelo sistema
  leads int check (leads >= 0),
  appointments int check (appointments >= 0),
  sales int check (sales >= 0),
  revenue numeric(10,2) check (revenue >= 0),
  notes text check (length(notes) <= 500),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, month, channel)
);
create trigger trg_marketing_entries_updated before update on public.marketing_entries
  for each row execute function public.set_updated_at();
create trigger trg_audit_marketing_entries after insert or update or delete on public.marketing_entries
  for each row execute function public.write_audit_log();

alter table public.marketing_entries enable row level security;
create policy marketing_entries_admin on public.marketing_entries for all to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));
grant select, insert, update, delete on public.marketing_entries to authenticated;

-- Por mês e canal: o lançado e o calculado.
--  leads        = leads criados no mês com a origem + clientes cadastradas no mês sem lead
--  agendamentos = agendamentos criados no mês para clientes do canal (remarcação não conta de novo)
--  vendas       = clientes do canal com a primeira comanda paga no mês
--  receita      = tudo que clientes do canal pagaram no mês
create or replace function public.marketing_report(p_salon_id uuid, p_months int default 12)
returns table (
  month date, channel public.marketing_channel, has_entry boolean, investment numeric,
  leads int, appointments int, sales int, revenue numeric,
  auto_leads int, auto_appointments int, auto_sales int, auto_revenue numeric, notes text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_first date;
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador vê Marketing & Vendas' using errcode = '42501';
  end if;
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_first := (date_trunc('month', now() at time zone v_tz) - make_interval(months => greatest(least(p_months, 36), 1) - 1))::date;

  return query
  with months as (
    select m::date as month from generate_series(v_first, date_trunc('month', now() at time zone v_tz)::date, interval '1 month') m
  ), ch as (
    select unnest(enum_range(null::public.marketing_channel)) as channel
  ), lead_n as (
    select date_trunc('month', l.created_at at time zone v_tz)::date as month, l.origin::text as channel, count(*) as n
    from public.leads l
    where l.salon_id = p_salon_id and l.created_at >= (v_first::timestamp at time zone v_tz)
    group by 1, 2
    union all
    select date_trunc('month', c.created_at at time zone v_tz)::date, c.origin::text, count(*)
    from public.clients c
    where c.salon_id = p_salon_id and c.created_at >= (v_first::timestamp at time zone v_tz)
      and not exists (select 1 from public.leads l where l.client_id = c.id)
    group by 1, 2
  ), appt_n as (
    select date_trunc('month', a.created_at at time zone v_tz)::date as month, c.origin::text as channel, count(*) as n
    from public.appointments a join public.clients c on c.id = a.client_id
    where a.salon_id = p_salon_id and a.rescheduled_from_id is null
      and a.created_at >= (v_first::timestamp at time zone v_tz)
    group by 1, 2
  ), first_order as (
    select o.client_id, min(o.closed_at) as at
    from public.orders o
    where o.salon_id = p_salon_id and o.status = 'fechada' and o.client_id is not null
    group by o.client_id
  ), sale_n as (
    select date_trunc('month', f.at at time zone v_tz)::date as month, c.origin::text as channel, count(*) as n
    from first_order f join public.clients c on c.id = f.client_id
    where f.at >= (v_first::timestamp at time zone v_tz)
    group by 1, 2
  ), rev as (
    select date_trunc('month', o.closed_at at time zone v_tz)::date as month, c.origin::text as channel, sum(o.total) as total
    from public.orders o join public.clients c on c.id = o.client_id
    where o.salon_id = p_salon_id and o.status = 'fechada'
      and o.closed_at >= (v_first::timestamp at time zone v_tz)
    group by 1, 2
  )
  select m.month, ch.channel, e.id is not null, coalesce(e.investment, 0),
         coalesce(e.leads, al.n::int), coalesce(e.appointments, aa.n::int), coalesce(e.sales, s.n::int), coalesce(e.revenue, r.total),
         al.n::int, aa.n::int, s.n::int, r.total, e.notes
  from months m
  cross join ch
  left join public.marketing_entries e on e.salon_id = p_salon_id and e.month = m.month and e.channel = ch.channel
  left join (select l.month, l.channel, sum(l.n) as n from lead_n l group by 1, 2) al on al.month = m.month and al.channel = ch.channel::text
  left join appt_n aa on aa.month = m.month and aa.channel = ch.channel::text
  left join sale_n s on s.month = m.month and s.channel = ch.channel::text
  left join rev r on r.month = m.month and r.channel = ch.channel::text
  order by m.month, ch.channel;
end $$;

-- ---------------------------------------------------------------------
-- Públicos de campanha: + "vieram e não voltaram" e "pacotes acabando"
-- ---------------------------------------------------------------------
create or replace function public.campaign_audience(p_salon_id uuid, p_audience text, p_days int default 60)
returns table (client_id uuid, name text, phone text, last_visit_at timestamptz, total_spent numeric)
language sql stable security invoker set search_path = public as $$
  select co.id, co.name, co.phone, co.last_visit_at, co.total_spent
  from public.client_overview co
  where co.salon_id = p_salon_id and co.archived_at is null and co.phone is not null and not co.opt_out
    and case p_audience
      when 'reativar' then co.last_visit_at < now() - make_interval(days => coalesce(p_days, 60))
                           and co.next_appointment_at is null and co.lost_at is null
      when 'retoque' then co.next_return_at <= now() and co.next_appointment_at is null
      when 'aniversariantes' then extract(month from co.birth_date) = extract(month from now() at time zone 'America/Sao_Paulo')
      when 'ativos' then co.lifecycle_status in ('ativo', 'agendado')
      when 'todos' then true
      when 'nao_voltaram' then co.visits_count = 1 and co.next_appointment_at is null and co.lost_at is null
                               and co.last_visit_at < now() - interval '30 days'
      when 'pacotes_acabando' then exists (
        select 1 from public.client_package_overview p
        where p.client_id = co.id and p.usable
        group by p.client_package_id, p.expires_at
        having sum(p.sessions_left) <= 1 or p.expires_at <= now() + interval '15 days')
      else false
    end
  order by co.total_spent desc nulls last, co.name
  limit 1000
$$;

-- ---------------------------------------------------------------------
-- Inteligência: serviços, faltas, mapa de ocupação e profissionais
-- ---------------------------------------------------------------------
create or replace function public.intelligence_report(p_salon_id uuid, p_days int default 90)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_from date;
  v_start timestamptz;
  v_services jsonb;
  v_noshow jsonb;
  v_heat jsonb;
  v_pros jsonb;
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador vê a Inteligência' using errcode = '42501';
  end if;
  p_days := least(greatest(coalesce(p_days, 90), 7), 365);
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_today := (now() at time zone v_tz)::date;
  v_from := v_today - p_days + 1;
  v_start := v_from::timestamp at time zone v_tz;

  -- Serviços que mais faturam
  select coalesce(jsonb_agg(x order by (x ->> 'revenue')::numeric desc), '[]'::jsonb) into v_services
  from (
    select jsonb_build_object('service_id', s.id, 'name', s.name, 'sales', sum(i.quantity)::int,
             'revenue', round(sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end), 2),
             'avg_ticket', round(sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end) / sum(i.quantity), 2)) as x
    from public.order_items i
    join public.orders o on o.id = i.order_id
    join public.services s on s.id = i.service_id
    where o.salon_id = p_salon_id and o.status = 'fechada' and o.closed_at >= v_start and i.kind = 'servico'
    group by s.id, s.name
    order by 1 desc
    limit 15
  ) t;

  -- Faltas por dia da semana (só horários que já passaram)
  select jsonb_agg(jsonb_build_object('weekday', d, 'total', coalesce(t.total, 0), 'no_shows', coalesce(t.ns, 0),
                                      'rate', case when t.total > 0 then round(t.ns::numeric / t.total, 4) end) order by d)
    into v_noshow
  from generate_series(1, 7) d
  left join (
    select extract(isodow from a.starts_at at time zone v_tz)::int as wd,
           count(*) as total, count(*) filter (where a.status = 'nao_compareceu') as ns
    from public.appointments a
    where a.salon_id = p_salon_id and a.starts_at >= v_start and a.starts_at < now()
      and a.status in ('concluido', 'em_atendimento', 'nao_compareceu')
    group by 1
  ) t on t.wd = d;

  -- Ocupação por dia da semana e hora (até 8 semanas para trás)
  select coalesce(jsonb_agg(jsonb_build_object('weekday', wd, 'hour', hr, 'available', avail, 'booked', booked,
                                               'rate', case when avail > 0 then round(booked::numeric / avail, 4) end)
                            order by wd, hr), '[]'::jsonb)
    into v_heat
  from (
    select extract(isodow from t.at at time zone v_tz)::int as wd, extract(hour from t.at at time zone v_tz)::int as hr,
           count(*) filter (where not t.blocked) as avail,
           count(*) filter (where t.booked and not t.blocked) as booked
    from public.occupancy_ticks(p_salon_id, greatest(v_from, v_today - 55), v_today) t
    group by 1, 2
  ) h;

  -- Desempenho por profissional
  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into v_pros
  from (
    select jsonb_build_object(
      'professional_id', p.id, 'name', p.name, 'color', p.color,
      'appointments', coalesce(ap.total, 0),
      'attended', coalesce(ap.attended, 0),
      'no_shows', coalesce(ap.no_shows, 0),
      'attendance_rate', case when coalesce(ap.attended, 0) + coalesce(ap.no_shows, 0) > 0
                              then round(ap.attended::numeric / (ap.attended + ap.no_shows), 4) end,
      'revenue', coalesce(rv.revenue, 0),
      'orders', coalesce(rv.orders, 0),
      'avg_ticket', case when coalesce(rv.orders, 0) > 0 then round(rv.revenue / rv.orders, 2) end,
      'product_revenue', coalesce(rv.products, 0),
      'clients', coalesce(rt.clients, 0),
      'returned', coalesce(rt.returned, 0),
      'return_rate', case when coalesce(rt.clients, 0) > 0 then round(rt.returned::numeric / rt.clients, 4) end
    ) as x
    from public.professionals p
    left join lateral (
      select count(distinct a.id) filter (where a.status not in ('cancelado', 'reagendado')) as total,
             count(distinct a.id) filter (where a.status in ('concluido', 'em_atendimento')) as attended,
             count(distinct a.id) filter (where a.status = 'nao_compareceu') as no_shows
      from public.appointment_items i join public.appointments a on a.id = i.appointment_id
      where i.professional_id = p.id and a.starts_at >= v_start and a.starts_at < now()
    ) ap on true
    left join lateral (
      select round(sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end), 2) as revenue,
             count(distinct o.id) as orders,
             round(sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end)
                   filter (where i.kind = 'produto'), 2) as products
      from public.order_items i join public.orders o on o.id = i.order_id
      where i.professional_id = p.id and o.status = 'fechada' and o.closed_at >= v_start
    ) rv on true
    left join lateral (
      -- Clientes atendidas por ela no período que voltaram ao salão depois
      -- (outra visita concluída ou um horário já marcado)
      select count(*) as clients,
             count(*) filter (where exists (
               select 1 from public.appointments a2
               where a2.client_id = f.client_id and a2.starts_at > f.first_at
                 and a2.status in ('concluido', 'em_atendimento', 'agendado', 'confirmado'))) as returned
      from (
        select a.client_id, min(a.starts_at) as first_at
        from public.appointment_items i join public.appointments a on a.id = i.appointment_id
        where i.professional_id = p.id and a.status = 'concluido' and a.starts_at >= v_start
        group by a.client_id
      ) f
    ) rt on true
    where p.salon_id = p_salon_id and p.active
  ) t;

  return jsonb_build_object('from', v_from, 'to', v_today, 'days', p_days,
                            'services', v_services, 'no_shows', v_noshow, 'heatmap', v_heat, 'professionals', v_pros);
end $$;

-- Plano de ação: oportunidades em ordem de impacto estimado (R$) e a próxima ação de cada uma
create or replace function public.intelligence_actions(p_salon_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_today date;
  v_ticket numeric;
  v_hour_value numeric;
  v_items jsonb := '[]'::jsonb;
  n int;
  r record;
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador vê a Inteligência' using errcode = '42501';
  end if;
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_today := (now() at time zone v_tz)::date;

  select coalesce(avg(total), 0) into v_ticket
  from public.orders where salon_id = p_salon_id and status = 'fechada' and closed_at >= now() - interval '60 days';
  select case when count(*) filter (where booked and not blocked) > 0
              then (select coalesce(sum(total), 0) from public.orders
                    where salon_id = p_salon_id and status = 'fechada' and closed_at >= now() - interval '30 days')
                   / (count(*) filter (where booked and not blocked) / 4.0)
              else 0 end
    into v_hour_value
  from public.occupancy_ticks(p_salon_id, v_today - 29, v_today);

  -- Leads parados
  select count(*) into n from public.leads l
  where l.salon_id = p_salon_id and l.archived_at is null and l.stage in ('novo', 'em_contato')
    and greatest(coalesce(l.last_message_at, l.created_at), l.stage_changed_at) < now() - interval '3 days';
  if n > 0 then
    v_items := v_items || jsonb_build_object('key', 'leads_parados', 'count', n, 'impact', round(n * v_ticket * 0.3, 2),
      'title', 'Retome ' || n || case when n = 1 then ' lead parado' else ' leads parados' end || ' há mais de 3 dias',
      'detail', 'Novo lead ou Em contato sem conversa nem mudança de etapa. Uma mensagem hoje recupera parte deles.',
      'action', jsonb_build_object('type', 'link', 'to', '/crm', 'label', 'Abrir o CRM'));
  end if;

  -- Follow-ups atrasados
  select count(*) into n from public.leads l
  where l.salon_id = p_salon_id and l.archived_at is null and l.next_follow_up_at < now()
    and l.stage not in ('cliente', 'perdido', 'base_fria');
  if n > 0 then
    v_items := v_items || jsonb_build_object('key', 'follow_ups', 'count', n, 'impact', round(n * v_ticket * 0.25, 2),
      'title', n || case when n = 1 then ' follow-up atrasado' else ' follow-ups atrasados' end,
      'detail', 'A data combinada para retomar a conversa já passou.',
      'action', jsonb_build_object('type', 'link', 'to', '/crm', 'label', 'Abrir o CRM'));
  end if;

  -- Listas de campanha
  for r in
    select * from (values
      ('retoque', 0.4, ' passaram da data de retocar', 'O intervalo de retorno do serviço já venceu e não há nada marcado.'),
      ('nao_voltaram', 0.2, ' vieram uma vez e não voltaram', 'Primeira visita há mais de 30 dias e nenhum horário marcado.'),
      ('reativar', 0.15, ' sem visita há mais de 60 dias', 'Clientes que sumiram. Quem mais gastou aparece primeiro na lista.'),
      ('pacotes_acabando', 0.5, ' com pacote acabando', 'Resta 1 sessão ou o pacote vence em até 15 dias: hora de oferecer a renovação.')
    ) v(audience, conv, label, detail)
  loop
    select count(*) into n from public.campaign_audience(p_salon_id, r.audience, 60);
    if n > 0 then
      v_items := v_items || jsonb_build_object('key', r.audience, 'count', n, 'impact', round(n * v_ticket * r.conv, 2),
        'title', n || case when n = 1 then ' cliente' else ' clientes' end || r.label,
        'detail', r.detail,
        'action', jsonb_build_object('type', 'campaign', 'audience', r.audience, 'label', 'Criar campanha'));
    end if;
  end loop;

  -- Dia vazio nos próximos 7 dias
  select d, avail, booked into r
  from (
    select (t.at at time zone v_tz)::date as d,
           count(*) filter (where not t.blocked) as avail,
           count(*) filter (where t.booked and not t.blocked) as booked
    from public.occupancy_ticks(p_salon_id, v_today + 1, v_today + 7) t
    group by 1
  ) x
  where avail >= 16 and booked::numeric / avail < 0.5
  order by booked::numeric / avail, d
  limit 1;
  if found then
    v_items := v_items || jsonb_build_object('key', 'dia_vazio', 'count', round((r.avail - r.booked) / 4.0, 1),
      'impact', round((r.avail - r.booked) / 4.0 * v_hour_value * 0.3, 2),
      'title', upper(left(public.weekday_pt(r.d), 1)) || substr(public.weekday_pt(r.d), 2) || ' (' || to_char(r.d, 'DD/MM') || ') ' ||
               round(100 - r.booked * 100.0 / r.avail) || '% vazio, dispare uma campanha',
      'detail', replace(round((r.avail - r.booked) / 4.0, 1)::text, '.', ',') || ' horas livres na agenda. Uma mensagem para clientes ativas costuma encher parte delas.',
      'action', jsonb_build_object('type', 'campaign', 'audience', 'ativos', 'label', 'Criar campanha', 'date', r.d));
  end if;

  -- Faltas altas e confirmação de 2h desligada
  select count(*) filter (where status = 'nao_compareceu') as ns, count(*) as total into r
  from public.appointments
  where salon_id = p_salon_id and starts_at >= now() - interval '30 days' and starts_at < now()
    and status in ('concluido', 'em_atendimento', 'nao_compareceu');
  if r.total >= 10 and r.ns >= r.total * 0.1 then
    n := r.ns;
    v_items := v_items || jsonb_build_object('key', 'faltas', 'count', n, 'impact', round(n * v_ticket * 0.5, 2),
      'title', n || ' faltas nos últimos 30 dias',
      'detail', case when exists (select 1 from public.automations where salon_id = p_salon_id and kind = 'confirmacao_2h' and not enabled)
                     then 'A confirmação 2h antes está desligada. Ligue para pedir o SIM no dia.'
                     else 'Revise a lista de quem faltou e use a recuperação de falta.' end,
      'action', jsonb_build_object('type', 'link', 'to', '/automacoes', 'label', 'Abrir Automações'));
  end if;

  return coalesce((
    select jsonb_agg(x || jsonb_build_object('rank', rn) order by rn)
    from (
      select x, row_number() over (order by (x ->> 'impact')::numeric desc, x ->> 'key') as rn
      from jsonb_array_elements(v_items) x
    ) t
    where rn <= 7
  ), '[]'::jsonb);
end $$;

revoke execute on function public.dashboard_summary(uuid, date, date) from public, anon;
revoke execute on function public.marketing_report(uuid, int) from public, anon;
revoke execute on function public.intelligence_report(uuid, int) from public, anon;
revoke execute on function public.intelligence_actions(uuid) from public, anon;
grant execute on function public.dashboard_summary(uuid, date, date) to authenticated;
grant execute on function public.marketing_report(uuid, int) to authenticated;
grant execute on function public.intelligence_report(uuid, int) to authenticated;
grant execute on function public.intelligence_actions(uuid) to authenticated;
