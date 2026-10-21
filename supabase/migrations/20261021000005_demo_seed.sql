-- =====================================================================
-- Salon OS · 005 · Salão de demonstração
-- seed_demo_salon(salon_id): 3 profissionais, 15 serviços, 30 clientes e
-- agendamentos das últimas 6 semanas + próxima semana. Só o admin chama,
-- e só em salão sem clientes (não mistura com dados reais).
-- =====================================================================

create or replace function public.seed_demo_salon(p_salon_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  c_cabelo uuid; c_unhas uuid; c_sobr uuid; c_make uuid; c_trat uuid;
  p_ana uuid; p_bia uuid; p_carla uuid;
  v_day date;
  v_prof uuid;
  v_slot timestamp;
  v_end timestamp;
  v_service record;
  v_client uuid;
  v_appt uuid;
  v_status public.appointment_status;
  v_r float;
  v_clients uuid[];
  v_first_names text[] := array['Ana','Beatriz','Camila','Daniela','Eduarda','Fernanda','Gabriela','Helena','Isabela','Juliana',
    'Larissa','Mariana','Natália','Olívia','Patrícia','Rafaela','Sabrina','Tatiane','Vanessa','Yasmin',
    'Bruno','Carlos','Diego','Felipe','Gustavo','Lucas','Marcos','Pedro','Rodrigo','Thiago'];
  v_last_names text[] := array['Silva','Santos','Oliveira','Souza','Lima','Pereira','Costa','Ferreira','Almeida','Ribeiro'];
  v_origins public.client_origin[] := array['indicacao','instagram','whatsapp','google','meta_ads','passante']::public.client_origin[];
  i int;
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Apenas o administrador do salão pode carregar a demonstração' using errcode = '42501';
  end if;
  if exists (select 1 from public.clients where salon_id = p_salon_id) then
    raise exception 'O salão já tem clientes; a demonstração só pode ser carregada num salão vazio';
  end if;

  perform setseed(0.42);
  select timezone into v_tz from public.salons where id = p_salon_id;

  update public.salons set business_hours = '{"2":[["09:00","19:00"]],"3":[["09:00","19:00"]],"4":[["09:00","19:00"]],"5":[["09:00","20:00"]],"6":[["08:00","18:00"]]}'::jsonb
   where id = p_salon_id and business_hours = '{}'::jsonb;

  -- Categorias
  insert into public.service_categories (salon_id, name, sort_order) values (p_salon_id, 'Cabelo', 1) returning id into c_cabelo;
  insert into public.service_categories (salon_id, name, sort_order) values (p_salon_id, 'Unhas', 2) returning id into c_unhas;
  insert into public.service_categories (salon_id, name, sort_order) values (p_salon_id, 'Sobrancelha', 3) returning id into c_sobr;
  insert into public.service_categories (salon_id, name, sort_order) values (p_salon_id, 'Maquiagem', 4) returning id into c_make;
  insert into public.service_categories (salon_id, name, sort_order) values (p_salon_id, 'Tratamentos', 5) returning id into c_trat;

  -- 15 serviços típicos (nome, categoria, duração, preço, a partir de, retorno, comissão)
  insert into public.services (salon_id, category_id, name, duration_minutes, price, price_is_starting, return_interval_days, default_commission_pct) values
    (p_salon_id, c_cabelo, 'Corte feminino', 60, 120, false, 60, 40),
    (p_salon_id, c_cabelo, 'Corte masculino', 30, 60, false, 30, 40),
    (p_salon_id, c_cabelo, 'Escova', 45, 70, false, 7, 40),
    (p_salon_id, c_cabelo, 'Coloração', 120, 220, true, 30, 35),
    (p_salon_id, c_cabelo, 'Mechas', 180, 450, true, 90, 35),
    (p_salon_id, c_cabelo, 'Progressiva', 180, 380, true, 90, 35),
    (p_salon_id, c_trat, 'Hidratação', 45, 90, false, 15, 40),
    (p_salon_id, c_trat, 'Cauterização', 60, 150, false, 30, 40),
    (p_salon_id, c_unhas, 'Manicure', 45, 40, false, 7, 50),
    (p_salon_id, c_unhas, 'Pedicure', 45, 45, false, 15, 50),
    (p_salon_id, c_unhas, 'Alongamento de unha', 120, 180, false, 21, 50),
    (p_salon_id, c_unhas, 'Esmaltação em gel', 60, 90, false, 21, 50),
    (p_salon_id, c_sobr, 'Design de sobrancelha', 30, 50, false, 20, 50),
    (p_salon_id, c_sobr, 'Design com henna', 45, 70, false, 20, 50),
    (p_salon_id, c_make, 'Maquiagem social', 60, 180, false, null, 50);

  -- 3 profissionais
  insert into public.professionals (salon_id, name, role_title, color, default_commission_pct, sort_order)
    values (p_salon_id, 'Ana Souza', 'Cabeleireira', '#B87A5E', 40, 1) returning id into p_ana;
  insert into public.professionals (salon_id, name, role_title, color, default_commission_pct, sort_order)
    values (p_salon_id, 'Bia Martins', 'Manicure e designer', '#7A8F6B', 50, 2) returning id into p_bia;
  insert into public.professionals (salon_id, name, role_title, color, default_commission_pct, sort_order)
    values (p_salon_id, 'Carla Nunes', 'Colorista', '#6B7A9F', 35, 3) returning id into p_carla;

  insert into public.professional_services (salon_id, professional_id, service_id)
  select p_salon_id, p_ana, id from public.services
   where salon_id = p_salon_id and category_id in (c_cabelo, c_trat) and name not in ('Mechas');
  insert into public.professional_services (salon_id, professional_id, service_id)
  select p_salon_id, p_bia, id from public.services
   where salon_id = p_salon_id and category_id in (c_unhas, c_sobr, c_make);
  insert into public.professional_services (salon_id, professional_id, service_id)
  select p_salon_id, p_carla, id from public.services
   where salon_id = p_salon_id and name in ('Coloração', 'Mechas', 'Progressiva', 'Hidratação', 'Cauterização', 'Escova');

  -- Jornada: terça a sábado, 09–12 e 13–19 (almoço 12–13)
  insert into public.professional_hours (salon_id, professional_id, weekday, start_time, end_time)
  select p_salon_id, p, d, t.s, t.e
  from unnest(array[p_ana, p_bia, p_carla]) p
  cross join generate_series(2, 6) d
  cross join (values ('09:00'::time, '12:00'::time), ('13:00'::time, '19:00'::time)) t(s, e);

  -- 30 clientes
  for i in 1..30 loop
    insert into public.clients (salon_id, name, phone, email, birth_date, origin, created_at)
    values (
      p_salon_id,
      v_first_names[i] || ' ' || v_last_names[1 + (i % 10)],
      '55119' || lpad((80000000 + i * 1237)::text, 8, '0'),
      lower(translate(v_first_names[i], 'áéíóúãõç', 'aeiouaoc')) || i || '@exemplo.com',
      date '1975-01-01' + (random() * 10000)::int,
      v_origins[1 + floor(random() * 6)::int],
      now() - make_interval(days => 50 + (random() * 200)::int)
    ) returning id into v_client;
    v_clients := v_clients || v_client;
  end loop;

  -- Agendamentos: 6 semanas para trás e 1 para frente
  for v_day in select generate_series(current_date - 42, current_date + 7, interval '1 day')::date loop
    continue when extract(isodow from v_day) not between 2 and 6;
    foreach v_prof in array array[p_ana, p_bia, p_carla] loop
      v_slot := v_day + time '09:00';
      while v_slot < v_day + time '19:00' loop
        if v_slot >= v_day + time '12:00' and v_slot < v_day + time '13:00' then
          v_slot := v_day + time '13:00';
        end if;
        -- deixa ~55% dos horários livres
        if random() < 0.55 then
          v_slot := v_slot + interval '30 minutes';
          continue;
        end if;
        select s.id, s.duration_minutes, s.price into v_service
        from public.professional_services ps join public.services s on s.id = ps.service_id
        where ps.professional_id = v_prof
        order by random() * (case when s.duration_minutes <= 60 then 3 else 1 end) desc
        limit 1;
        v_end := v_slot + make_interval(mins => v_service.duration_minutes);
        -- respeita almoço e fim do dia
        if (v_slot < v_day + time '12:00' and v_end > v_day + time '12:00') then
          v_slot := v_day + time '13:00';
          continue;
        end if;
        exit when v_end > v_day + time '19:00';

        v_r := random();
        if v_day < current_date then
          v_status := case when v_r < 0.82 then 'concluido' when v_r < 0.91 then 'nao_compareceu' else 'cancelado' end;
        elsif v_day = current_date then
          v_status := case when v_r < 0.5 then 'confirmado' else 'agendado' end;
        else
          v_status := case when v_r < 0.3 then 'confirmado' else 'agendado' end;
        end if;

        insert into public.appointments (salon_id, client_id, status, origin, starts_at, ends_at,
                                         created_at, completed_at, confirmed_at, cancelled_at)
        values (
          -- clientes 1–12 são frequentes, 13–20 ocasionais; 21–30 ficam para os perfis abaixo
          p_salon_id, case when random() < 0.7 then v_clients[1 + floor(random() * 12)::int] else v_clients[13 + floor(random() * 8)::int] end, 'agendado',
          (array['recepcao','recepcao','whatsapp','link_online']::public.appointment_origin[])[1 + floor(random() * 4)::int],
          v_slot at time zone v_tz, v_end at time zone v_tz,
          (v_slot at time zone v_tz) - interval '5 days', null, null, null
        ) returning id into v_appt;
        insert into public.appointment_items (salon_id, appointment_id, service_id, professional_id, starts_at, ends_at, price)
        values (p_salon_id, v_appt, v_service.id, v_prof, v_slot at time zone v_tz, v_end at time zone v_tz, v_service.price);
        if v_status <> 'agendado' then
          update public.appointments set status = v_status where id = v_appt;
          update public.appointments
             set completed_at = case when v_status = 'concluido' then ends_at end,
                 confirmed_at = case when v_status in ('confirmado', 'concluido') then starts_at - interval '1 day' end,
                 cancelled_at = case when v_status = 'cancelado' then starts_at - interval '1 day' end
           where id = v_appt;
        end if;

        v_slot := v_end;
      end loop;
    end loop;
  end loop;

  -- Clientes 21–25: sumidas (última visita entre 75 e 150 dias atrás) → "Em risco"/"Inativo" e "Hora de retocar"
  for i in 21..25 loop
    v_day := current_date - (75 + (i - 21) * 18);
    while extract(isodow from v_day) not between 2 and 6 loop v_day := v_day - 1; end loop;
    select s.id, s.duration_minutes, s.price into v_service
    from public.professional_services ps join public.services s on s.id = ps.service_id
    where ps.professional_id = p_carla order by s.duration_minutes limit 1 offset (i % 3);
    v_slot := v_day + (array[time '09:00', time '10:00', time '13:00', time '14:00', time '15:00'])[i - 20];
    v_end := v_slot + make_interval(mins => v_service.duration_minutes);
    insert into public.appointments (salon_id, client_id, status, origin, starts_at, ends_at, created_at)
    values (p_salon_id, v_clients[i], 'agendado', 'recepcao', v_slot at time zone v_tz, v_end at time zone v_tz, (v_slot at time zone v_tz) - interval '3 days')
    returning id into v_appt;
    insert into public.appointment_items (salon_id, appointment_id, service_id, professional_id, starts_at, ends_at, price)
    values (p_salon_id, v_appt, v_service.id, p_carla, v_slot at time zone v_tz, v_end at time zone v_tz, v_service.price);
    update public.appointments set status = 'concluido' where id = v_appt;
    update public.appointments set completed_at = ends_at where id = v_appt;
  end loop;

  -- Clientes 26–30: leads que ainda não vieram (26 e 27 já têm horário marcado na semana que vem)
  for i in 26..27 loop
    v_day := current_date + 7 + (i - 26);
    while extract(isodow from v_day) not between 2 and 6 loop v_day := v_day + 1; end loop;
    select s.id, s.duration_minutes, s.price into v_service
    from public.professional_services ps join public.services s on s.id = ps.service_id
    where ps.professional_id = p_bia order by s.duration_minutes limit 1;
    v_slot := v_day + time '18:00';
    v_end := v_slot + make_interval(mins => v_service.duration_minutes);
    continue when exists (
      select 1 from public.appointment_items
      where professional_id = p_bia and occupies
        and tstzrange(starts_at, ends_at) && tstzrange(v_slot at time zone v_tz, v_end at time zone v_tz));
    insert into public.appointments (salon_id, client_id, status, origin, starts_at, ends_at)
    values (p_salon_id, v_clients[i], 'agendado', 'link_online', v_slot at time zone v_tz, v_end at time zone v_tz)
    returning id into v_appt;
    insert into public.appointment_items (salon_id, appointment_id, service_id, professional_id, starts_at, ends_at, price)
    values (p_salon_id, v_appt, v_service.id, p_bia, v_slot at time zone v_tz, v_end at time zone v_tz, v_service.price);
  end loop;
  update public.clients set created_at = now() - make_interval(days => (random() * 10)::int)
   where id = any(v_clients[26:30]);

  update public.salons set onboarding_completed = true where id = p_salon_id;
end $$;

revoke execute on function public.seed_demo_salon(uuid) from public, anon;
grant execute on function public.seed_demo_salon(uuid) to authenticated;
