-- =====================================================================
-- Salon OS · 010 · Agendamento online (/agendar/[slug])
-- Página pública: escolhe serviço(s), profissional (ou "qualquer um") e um
-- horário livre de verdade (jornada, bloqueios e agenda). As três funções
-- abaixo são as únicas portas para o visitante anônimo.
-- =====================================================================

alter table public.salons
  add column online_booking_enabled boolean not null default true,
  add column online_booking_min_hours int not null default 2 check (online_booking_min_hours between 0 and 168),
  add column online_booking_max_days int not null default 30 check (online_booking_max_days between 1 and 180),
  add column online_booking_step_minutes int not null default 15 check (online_booking_step_minutes in (5, 10, 15, 20, 30, 60)),
  add column online_booking_message text check (length(online_booking_message) <= 500);

-- Profissional faz o serviço: está ligado a ele, ou o serviço não tem ninguém ligado
create or replace function public.pro_does_service(p_professional_id uuid, p_service_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.professional_services where professional_id = p_professional_id and service_id = p_service_id)
      or not exists (select 1 from public.professional_services where service_id = p_service_id)
$$;

-- Vitrine: dados do salão, serviços e profissionais que aparecem no link
create or replace function public.public_booking_salon(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'name', s.name,
    'slug', s.slug,
    'whatsapp', s.whatsapp,
    'address', nullif(concat_ws(', ',
                 nullif(concat_ws(', ', nullif(trim(s.address_street), ''), nullif(trim(s.address_number), '')), ''),
                 nullif(trim(s.address_district), ''),
                 nullif(concat_ws(' - ', nullif(trim(s.address_city), ''), nullif(trim(s.address_state), '')), '')), ''),
    'timezone', s.timezone,
    'min_hours', s.online_booking_min_hours,
    'max_days', s.online_booking_max_days,
    'message', s.online_booking_message,
    'business_hours', s.business_hours,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name, 'description', v.description, 'category', c.name,
               'duration_minutes', v.duration_minutes, 'price', v.price, 'price_is_starting', v.price_is_starting)
             order by coalesce(c.sort_order, 999), c.name, v.name)
      from public.services v
      left join public.service_categories c on c.id = v.category_id
      where v.salon_id = s.id and v.active and v.online_booking
    ), '[]'::jsonb),
    'professionals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'name', p.name, 'role_title', p.role_title, 'color', p.color,
               'service_ids', (select coalesce(jsonb_agg(v.id), '[]'::jsonb) from public.services v
                               where v.salon_id = s.id and v.active and v.online_booking
                                 and public.pro_does_service(p.id, v.id)))
             order by p.sort_order, p.name)
      from public.professionals p
      where p.salon_id = s.id and p.active
    ), '[]'::jsonb)
  )
  from public.salons s
  where s.slug = p_slug and s.suspended_at is null and s.online_booking_enabled
$$;

-- Horários livres num dia. Sem profissional = "qualquer um" (fica com quem
-- tem menos atendimentos no dia).
create or replace function public.public_booking_slots(
  p_slug text, p_service_ids uuid[], p_professional_id uuid, p_date date
) returns table (starts_at timestamptz, ends_at timestamptz, professional_id uuid, professional_name text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  sl public.salons;
  v_today date;
begin
  select * into sl from public.salons
   where slug = p_slug and suspended_at is null and online_booking_enabled;
  if not found or coalesce(cardinality(p_service_ids), 0) = 0 or cardinality(p_service_ids) > 5 then
    return;
  end if;
  v_today := (now() at time zone sl.timezone)::date;
  if p_date < v_today or p_date > v_today + sl.online_booking_max_days then
    return;
  end if;

  return query
  with svc as (
    select v.id, v.duration_minutes from public.services v
    where v.salon_id = sl.id and v.id = any(p_service_ids) and v.active and v.online_booking
  ),
  pros as (
    select p.id, p.name, p.sort_order,
           (select sum(coalesce(ps.duration_minutes, v.duration_minutes))
              from svc v left join public.professional_services ps
                on ps.service_id = v.id and ps.professional_id = p.id)::int as dur
    from public.professionals p
    where p.salon_id = sl.id and p.active
      and (p_professional_id is null or p.id = p_professional_id)
      and (select count(*) from svc) = cardinality(p_service_ids)
      and not exists (select 1 from svc v where not public.pro_does_service(p.id, v.id))
  ),
  ranges as (
    select pr.id as pro, h.start_time as rs, h.end_time as re
    from pros pr join public.professional_hours h
      on h.professional_id = pr.id and h.weekday = extract(isodow from p_date)
    union all
    select pr.id, (r ->> 0)::time, (r ->> 1)::time
    from pros pr
    cross join lateral jsonb_array_elements(coalesce(sl.business_hours -> extract(isodow from p_date)::text, '[]'::jsonb)) r
    where not exists (select 1 from public.professional_hours h where h.professional_id = pr.id)
  ),
  cand as (
    select pr.id as pro, pr.name, pr.sort_order,
           (t at time zone sl.timezone) as st,
           (t at time zone sl.timezone) + make_interval(mins => pr.dur) as en
    from ranges r
    join pros pr on pr.id = r.pro
    cross join lateral generate_series(
      p_date + r.rs, p_date + r.re - make_interval(mins => pr.dur),
      make_interval(mins => sl.online_booking_step_minutes)) t
    where pr.dur > 0
  ),
  free as (
    select c.* from cand c
    where c.st >= now() + make_interval(hours => sl.online_booking_min_hours)
      and not exists (
        select 1 from public.appointment_items i
        where i.professional_id = c.pro and i.occupies
          and tstzrange(i.starts_at, i.ends_at, '[)') && tstzrange(c.st, c.en, '[)'))
      and not exists (
        select 1 from public.schedule_blocks b
        where b.salon_id = sl.id and (b.professional_id is null or b.professional_id = c.pro)
          and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(c.st, c.en, '[)'))
  ),
  load as (
    select i.professional_id as pro, count(*) as busy
    from public.appointment_items i
    where i.salon_id = sl.id and i.occupies
      and (i.starts_at at time zone sl.timezone)::date = p_date
    group by i.professional_id
  )
  select distinct on (f.st) f.st, f.en, f.pro, f.name
  from free f left join load l on l.pro = f.pro
  order by f.st, coalesce(l.busy, 0), f.sort_order, f.name;
end $$;

-- Reserva. Serializa por salão, revalida o horário, acha ou cria a cliente
-- pelo telefone e marca com origem "link online". A confirmação por
-- WhatsApp sai pela automação de confirmação.
create or replace function public.public_book_appointment(
  p_slug text, p_service_ids uuid[], p_professional_id uuid, p_starts_at timestamptz,
  p_name text, p_phone text, p_notes text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  sl public.salons;
  v_phone text := public.normalize_phone(p_phone);
  v_name text := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_slot record;
  v_client uuid;
  v_new_client boolean := false;
  v_appt uuid;
  v_cursor timestamptz;
  v_svc record;
  v_pos int := 0;
  v_services text;
  v_total numeric := 0;
begin
  select * into sl from public.salons
   where slug = p_slug and suspended_at is null and online_booking_enabled;
  if not found then
    raise exception 'Agendamento online indisponível';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Informe seu nome';
  end if;
  if v_phone is null or v_phone !~ '^55\d{10,11}$' then
    raise exception 'Informe um WhatsApp válido com DDD';
  end if;
  if length(coalesce(p_notes, '')) > 300 then
    raise exception 'A observação pode ter até 300 caracteres';
  end if;
  if coalesce(cardinality(p_service_ids), 0) = 0 or cardinality(p_service_ids) > 5
     or (select count(distinct x) from unnest(p_service_ids) x) <> cardinality(p_service_ids) then
    raise exception 'Escolha de 1 a 5 serviços';
  end if;

  perform pg_advisory_xact_lock(hashtext('booking:' || sl.id::text));

  -- Limites contra abuso
  if (select count(*) from public.appointments a join public.clients c on c.id = a.client_id
      where a.salon_id = sl.id and a.origin = 'link_online' and a.status in ('agendado', 'confirmado')
        and a.starts_at > now() and public.phone_key(c.phone) = public.phone_key(v_phone)) >= 3 then
    raise exception 'LIMITE: você já tem 3 horários marcados. Fale com o salão para marcar mais.';
  end if;
  if (select count(*) from public.appointments
      where salon_id = sl.id and origin = 'link_online' and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'LIMITE: muitos agendamentos agora. Tente de novo em alguns minutos.';
  end if;

  select * into v_slot
  from public.public_booking_slots(p_slug, p_service_ids, p_professional_id,
                                   (p_starts_at at time zone sl.timezone)::date) s
  where s.starts_at = p_starts_at
  limit 1;
  if v_slot.professional_id is null then
    raise exception 'HORARIO_INDISPONIVEL: esse horário acabou de ser ocupado. Escolha outro.';
  end if;

  select id into v_client from public.clients
   where salon_id = sl.id and archived_at is null and public.phone_key(phone) = public.phone_key(v_phone)
   order by created_at limit 1;
  if v_client is null then
    insert into public.clients (salon_id, name, phone, origin)
    values (sl.id, v_name, v_phone, 'link_online')
    returning id into v_client;
    v_new_client := true;
  end if;

  select string_agg(v.name, ' + ' order by array_position(p_service_ids, v.id)) into v_services
  from public.services v where v.id = any(p_service_ids);

  -- Cliente nova entra no CRM; o card anda para "Agendado" com o agendamento
  if v_new_client and not exists (
    select 1 from public.leads where salon_id = sl.id and archived_at is null
      and (client_id = v_client or public.phone_key(phone) = public.phone_key(v_phone))
  ) then
    insert into public.leads (salon_id, client_id, name, phone, origin, interest)
    values (sl.id, v_client, v_name, v_phone, 'link_online', v_services);
  end if;

  insert into public.appointments (salon_id, client_id, status, origin, notes, starts_at, ends_at)
  values (sl.id, v_client, 'agendado', 'link_online', nullif(trim(p_notes), ''), v_slot.starts_at, v_slot.ends_at)
  returning id into v_appt;

  v_cursor := v_slot.starts_at;
  for v_svc in
    select v.id, coalesce(ps.duration_minutes, v.duration_minutes) as dur, coalesce(ps.price, v.price) as price
    from unnest(p_service_ids) with ordinality u(sid, ord)
    join public.services v on v.id = u.sid
    left join public.professional_services ps on ps.service_id = v.id and ps.professional_id = v_slot.professional_id
    order by u.ord
  loop
    insert into public.appointment_items (salon_id, appointment_id, service_id, professional_id, position, starts_at, ends_at, price)
    values (sl.id, v_appt, v_svc.id, v_slot.professional_id, v_pos, v_cursor, v_cursor + make_interval(mins => v_svc.dur), v_svc.price);
    v_cursor := v_cursor + make_interval(mins => v_svc.dur);
    v_total := v_total + v_svc.price;
    v_pos := v_pos + 1;
  end loop;

  perform public.notify(sl.id, 'agendamento_online',
    'Agendamento pelo link: ' || v_name,
    v_services || ' com ' || v_slot.professional_name || ', ' ||
      public.weekday_pt((v_slot.starts_at at time zone sl.timezone)::date) || ' ' ||
      to_char(v_slot.starts_at at time zone sl.timezone, 'DD/MM "às" HH24:MI'),
    '/agenda?agendamento=' || v_appt);

  return jsonb_build_object(
    'appointment_id', v_appt,
    'starts_at', v_slot.starts_at,
    'ends_at', v_slot.ends_at,
    'professional_name', v_slot.professional_name,
    'services', v_services,
    'total', v_total,
    'salon_name', sl.name
  );
end $$;

revoke execute on function public.pro_does_service(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pro_does_service(uuid, uuid) to service_role;
do $$
declare f text;
begin
  foreach f in array array[
    'public_booking_salon(text)',
    'public_booking_slots(text, uuid[], uuid, date)',
    'public_book_appointment(text, uuid[], uuid, timestamptz, text, text, text)'
  ] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
