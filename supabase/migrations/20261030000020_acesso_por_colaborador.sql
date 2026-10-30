-- =====================================================================
-- Salon OS · 020 · Acesso por colaborador
-- O dono vê o salão inteiro e o resultado de cada pessoa da equipe.
-- Cada colaborador vê só o que é dele: agenda, faturamento, comissões,
-- clientes para chamar de volta e as mensagens automáticas das clientes dele.
-- Tudo garantido aqui no banco; a tela só reflete.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Percentual de comissão dos colegas
-- O cadastro de profissionais é lido por toda a equipe (agenda, nomes, cores),
-- mas o percentual de comissão de cada um só o administrador vê.
-- ---------------------------------------------------------------------
revoke select on public.professionals from anon, authenticated;
grant select (id, salon_id, name, role_title, phone, email, color, user_id, sort_order, active, created_at, updated_at)
  on public.professionals to authenticated;

revoke select on public.professional_services from anon, authenticated;
grant select (salon_id, professional_id, service_id, price, duration_minutes)
  on public.professional_services to authenticated;

create or replace function public.commission_rates(p_salon_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador vê os percentuais de comissão' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'professionals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'default_commission_pct', p.default_commission_pct))
      from public.professionals p where p.salon_id = p_salon_id), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('professional_id', ps.professional_id, 'service_id', ps.service_id,
                                          'commission_pct', ps.commission_pct))
      from public.professional_services ps where ps.salon_id = p_salon_id and ps.commission_pct is not null), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 2. Convite aceito já liga o login ao cadastro de profissional
-- Se o salão tem um profissional sem login com o mesmo e-mail do convite,
-- a pessoa entra e já cai na própria agenda.
-- ---------------------------------------------------------------------
create or replace function public.accept_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  inv public.invitations;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '28000';
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into inv from public.invitations where token = p_token for update;
  if not found then
    raise exception 'Convite não encontrado';
  end if;
  if inv.revoked_at is not null then
    raise exception 'Este convite foi cancelado';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Este convite já foi usado';
  end if;
  if inv.expires_at < now() then
    raise exception 'Este convite expirou. Peça um novo ao salão.';
  end if;
  if inv.email <> v_email then
    raise exception 'Este convite foi enviado para outro e-mail';
  end if;

  insert into public.salon_members (salon_id, user_id, role)
  values (inv.salon_id, auth.uid(), inv.role)
  on conflict (salon_id, user_id) do update set role = excluded.role, active = true;

  if inv.role = 'profissional'
     and not exists (select 1 from public.professionals where salon_id = inv.salon_id and user_id = auth.uid()) then
    update public.professionals set user_id = auth.uid()
     where id = (select id from public.professionals
                  where salon_id = inv.salon_id and user_id is null and lower(trim(email)) = v_email
                  order by active desc, created_at limit 1);
  end if;

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  update public.profiles
    set current_salon_id = inv.salon_id,
        full_name = coalesce(nullif(full_name, ''), inv.full_name)
    where id = auth.uid();
  return inv.salon_id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Indicadores de um profissional num período (interna)
-- Faturamento = itens que ele fez ou vendeu em comandas fechadas, menos a
-- parte proporcional do desconto da comanda (mesma regra da Inteligência).
-- ---------------------------------------------------------------------
create or replace function public.professional_period(p_salon_id uuid, p_professional_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  r_rev record;
  r_ap record;
  v_avail int;
  v_booked int;
  v_clients int;
  v_new int;
  v_comm numeric;
begin
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  select coalesce(round(sum(x.net), 2), 0) as revenue,
         coalesce(round(sum(x.net) filter (where x.kind = 'servico'), 2), 0) as services_revenue,
         coalesce(round(sum(x.net) filter (where x.kind = 'produto'), 2), 0) as product_revenue,
         coalesce(sum(x.quantity) filter (where x.kind = 'servico'), 0)::int as services_count,
         count(distinct x.order_id) as orders
    into r_rev
  from (
    select i.order_id, i.kind, i.quantity,
           i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end as net
    from public.order_items i join public.orders o on o.id = i.order_id
    where i.professional_id = p_professional_id and o.salon_id = p_salon_id and o.status = 'fechada'
      and o.closed_at >= v_start and o.closed_at < v_end
  ) x;

  select count(distinct a.id) filter (where a.status not in ('cancelado', 'reagendado')) as total,
         count(distinct a.id) filter (where a.status in ('concluido', 'em_atendimento')) as attended,
         count(distinct a.id) filter (where a.status = 'nao_compareceu') as no_shows
    into r_ap
  from public.appointment_items i join public.appointments a on a.id = i.appointment_id
  where i.professional_id = p_professional_id and a.salon_id = p_salon_id
    and a.starts_at >= v_start and a.starts_at < v_end;

  select count(*) filter (where not blocked), count(*) filter (where booked and not blocked)
    into v_avail, v_booked
  from public.occupancy_ticks(p_salon_id, p_from, p_to)
  where professional_id = p_professional_id;

  -- Clientes atendidas no período; nova = primeira vez com este profissional
  select count(*), count(*) filter (where f.first_ever >= v_start)
    into v_clients, v_new
  from (
    select a.client_id,
           (select min(a2.starts_at) from public.appointments a2
              join public.appointment_items i2 on i2.appointment_id = a2.id
             where a2.client_id = a.client_id and i2.professional_id = p_professional_id
               and a2.status = 'concluido') as first_ever
    from public.appointment_items i join public.appointments a on a.id = i.appointment_id
    where i.professional_id = p_professional_id and a.salon_id = p_salon_id and a.status = 'concluido'
      and a.starts_at >= v_start and a.starts_at < v_end
    group by a.client_id
  ) f;

  select coalesce(sum(amount), 0) into v_comm
  from public.commissions
  where professional_id = p_professional_id and status <> 'estornada' and competence_date between p_from and p_to;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', r_rev.revenue,
    'services_revenue', r_rev.services_revenue,
    'product_revenue', r_rev.product_revenue,
    'services_count', r_rev.services_count,
    'orders', r_rev.orders,
    'avg_ticket', case when r_rev.orders > 0 then round(r_rev.revenue / r_rev.orders, 2) end,
    'appointments', r_ap.total,
    'attended', r_ap.attended,
    'no_shows', r_ap.no_shows,
    'attendance_rate', case when r_ap.attended + r_ap.no_shows > 0
                            then round(r_ap.attended::numeric / (r_ap.attended + r_ap.no_shows), 4) end,
    'booked_hours', round(coalesce(v_booked, 0) / 4.0, 1),
    'available_hours', round(coalesce(v_avail, 0) / 4.0, 1),
    'occupancy', case when v_avail > 0 then round(v_booked::numeric / v_avail, 4) end,
    'clients', v_clients,
    'new_clients', v_new,
    'commissions', v_comm
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. Meu painel: tudo do profissional logado
-- O profissional só abre o próprio. O administrador pode abrir o de qualquer
-- pessoa da equipe passando p_professional_id.
-- ---------------------------------------------------------------------
create or replace function public.professional_panel(
  p_salon_id uuid, p_from date, p_to date, p_professional_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pro public.professionals;
  v_id uuid;
  v_tz text;
  v_today date;
  v_days int := p_to - p_from + 1;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_prev_to date := p_from - 1;
  v_weekly boolean := (p_to - p_from + 1) > 62;
  v_series jsonb;
  v_services jsonb;
  v_today_list jsonb;
  v_to_call jsonb;
  v_messages jsonb;
  v_msg_stats jsonb;
  v_pending numeric;
  v_rate numeric;
begin
  if not public.is_salon_member(p_salon_id) then
    raise exception 'Sem acesso a este salão' using errcode = '42501';
  end if;
  if p_professional_id is not null and public.is_salon_admin(p_salon_id) then
    v_id := p_professional_id;
  elsif p_professional_id is not null and p_professional_id is distinct from public.my_professional_id(p_salon_id) then
    raise exception 'Você só vê o seu próprio painel' using errcode = '42501';
  else
    v_id := public.my_professional_id(p_salon_id);
  end if;
  if v_id is null then
    raise exception 'SEM_CADASTRO: seu login ainda não está ligado a um cadastro de profissional. Peça ao dono do salão para ligar em Equipe.';
  end if;
  select * into v_pro from public.professionals where id = v_id and salon_id = p_salon_id;
  if not found then
    raise exception 'Profissional não encontrado';
  end if;
  if p_to < p_from or v_days > 400 then
    raise exception 'Período inválido (até 400 dias)';
  end if;
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_today := (now() at time zone v_tz)::date;

  -- Faturamento dele por dia (ou semana), com o mesmo dia do período anterior
  with days as (
    select d::date as d, (case when v_weekly then date_trunc('week', d)::date else d::date end) as bucket
    from generate_series(p_from, p_to, interval '1 day') d
  ), rev as (
    select (o.closed_at at time zone v_tz)::date as d,
           sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end) as total
    from public.order_items i join public.orders o on o.id = i.order_id
    where i.professional_id = v_id and o.status = 'fechada'
      and o.closed_at >= (v_prev_from::timestamp at time zone v_tz)
      and o.closed_at < ((p_to + 1)::timestamp at time zone v_tz)
    group by 1
  ), per_bucket as (
    select days.bucket, round(coalesce(sum(c.total), 0), 2) as cur, round(coalesce(sum(p.total), 0), 2) as prev
    from days
    left join rev c on c.d = days.d
    left join rev p on p.d = days.d - v_days
    group by days.bucket
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket, 'current', cur, 'previous', prev) order by bucket), '[]'::jsonb)
    into v_series
  from per_bucket;

  -- O que ele mais vende
  select coalesce(jsonb_agg(x order by (x ->> 'revenue')::numeric desc), '[]'::jsonb) into v_services
  from (
    select jsonb_build_object('name', i.description, 'kind', i.kind, 'quantity', sum(i.quantity),
             'revenue', round(sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end), 2)) as x
    from public.order_items i join public.orders o on o.id = i.order_id
    where i.professional_id = v_id and o.status = 'fechada'
      and o.closed_at >= (p_from::timestamp at time zone v_tz) and o.closed_at < ((p_to + 1)::timestamp at time zone v_tz)
    group by i.description, i.kind
    order by 1 desc
    limit 8
  ) t;

  -- Agenda de hoje
  select coalesce(jsonb_agg(x order by x ->> 'starts_at'), '[]'::jsonb) into v_today_list
  from (
    select jsonb_build_object(
             'id', a.id, 'starts_at', min(i.starts_at), 'ends_at', max(i.ends_at), 'status', a.status,
             'client_id', c.id, 'client_name', c.name,
             'services', string_agg(s.name, ' + ' order by i.position)) as x
    from public.appointment_items i
    join public.appointments a on a.id = i.appointment_id
    join public.clients c on c.id = a.client_id
    join public.services s on s.id = i.service_id
    where i.professional_id = v_id and a.salon_id = p_salon_id
      and a.status not in ('cancelado', 'reagendado')
      and i.starts_at >= (v_today::timestamp at time zone v_tz) and i.starts_at < ((v_today + 1)::timestamp at time zone v_tz)
    group by a.id, a.status, c.id, c.name
  ) t;

  -- Clientes dele para chamar de volta: passou da data de retocar ou sumiu há mais de 60 dias,
  -- sem nada marcado no salão (nem com colegas) e sem pedir para não receber mensagens.
  select coalesce(jsonb_agg(x order by (x ->> 'priority')::int, x ->> 'last_visit_at' desc), '[]'::jsonb) into v_to_call
  from (
    select jsonb_build_object(
             'client_id', c.id, 'name', c.name, 'phone', c.phone,
             'last_visit_at', lv.last_at, 'last_service', lv.last_service,
             'return_at', lv.return_at,
             'reason', case when lv.return_at is not null and lv.return_at <= now() then 'retoque' else 'sumiu' end,
             'priority', case when lv.return_at is not null and lv.return_at <= now() then 1 else 2 end) as x
    from public.clients c
    cross join lateral (
      select a.starts_at as last_at,
             (select string_agg(s.name, ' + ' order by i.position)
                from public.appointment_items i join public.services s on s.id = i.service_id
               where i.appointment_id = a.id and i.professional_id = v_id) as last_service,
             a.starts_at + make_interval(days => (
               select min(s.return_interval_days) from public.appointment_items i
                 join public.services s on s.id = i.service_id
                where i.appointment_id = a.id and i.professional_id = v_id)) as return_at
      from public.appointments a
      where a.client_id = c.id and a.status = 'concluido'
        and exists (select 1 from public.appointment_items i where i.appointment_id = a.id and i.professional_id = v_id)
      order by a.starts_at desc
      limit 1
    ) lv
    where c.salon_id = p_salon_id and c.archived_at is null and c.lost_at is null and not c.opt_out
      and c.phone is not null
      and not exists (select 1 from public.appointments a2
                       where a2.client_id = c.id and a2.status in ('agendado', 'confirmado') and a2.starts_at >= now())
      and not exists (select 1 from public.appointments a3
                       where a3.client_id = c.id and a3.status = 'concluido' and a3.starts_at > lv.last_at)
      and ((lv.return_at is not null and lv.return_at <= now()) or lv.last_at < now() - interval '60 days')
    order by case when lv.return_at is not null and lv.return_at <= now() then 1 else 2 end, lv.last_at desc
    limit 30
  ) t;

  -- Mensagens automáticas das clientes dele (agendamentos com ele), últimos 30 dias
  select coalesce(jsonb_agg(x order by x ->> 'at' desc), '[]'::jsonb) into v_messages
  from (
    select jsonb_build_object('id', q.id, 'kind', q.kind, 'status', q.status,
             'at', coalesce(q.sent_at, q.scheduled_for), 'client_name', c.name) as x
    from public.message_queue q
    left join public.clients c on c.id = q.client_id
    where q.salon_id = p_salon_id and q.appointment_id is not null
      and q.scheduled_for >= now() - interval '30 days' and q.scheduled_for < now() + interval '7 days'
      and exists (select 1 from public.appointment_items i where i.appointment_id = q.appointment_id and i.professional_id = v_id)
    order by coalesce(q.sent_at, q.scheduled_for) desc
    limit 20
  ) t;

  select jsonb_build_object(
           'sent', count(*) filter (where q.status = 'enviada'),
           'scheduled', count(*) filter (where q.status = 'pendente'),
           'failed', count(*) filter (where q.status = 'falhou'))
    into v_msg_stats
  from public.message_queue q
  where q.salon_id = p_salon_id and q.appointment_id is not null
    and q.scheduled_for >= now() - interval '30 days' and q.scheduled_for < now() + interval '7 days'
    and exists (select 1 from public.appointment_items i where i.appointment_id = q.appointment_id and i.professional_id = v_id);

  select coalesce(sum(amount), 0) into v_pending
  from public.commissions where professional_id = v_id and status = 'pendente';

  -- Comissão que ele recebe: o próprio padrão, ou o do serviço quando ele não tem um
  v_rate := nullif(v_pro.default_commission_pct, 0);

  return jsonb_build_object(
    'professional', jsonb_build_object('id', v_pro.id, 'name', v_pro.name, 'color', v_pro.color,
                                       'role_title', v_pro.role_title, 'commission_pct', v_rate),
    'current', public.professional_period(p_salon_id, v_id, p_from, p_to),
    'previous', public.professional_period(p_salon_id, v_id, v_prev_from, v_prev_to),
    'granularity', case when v_weekly then 'semana' else 'dia' end,
    'series', v_series,
    'top_services', v_services,
    'today', v_today_list,
    'to_call', v_to_call,
    'messages', v_messages,
    'message_stats', v_msg_stats,
    'commissions_pending', v_pending
  );
end $$;

-- ---------------------------------------------------------------------
-- 5. Equipe: quanto cada pessoa faturou e quanto isso é do salão (só o dono)
-- ---------------------------------------------------------------------
create or replace function public.team_report(p_salon_id uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_tz text;
  v_start timestamptz;
  v_end timestamptz;
  v_prev_from date := p_from - (p_to - p_from + 1);
  v_prev_to date := p_from - 1;
  v_total numeric;
  v_prev_total numeric;
  v_rows jsonb;
  v_assigned numeric;
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador vê o resultado da equipe' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'Período inválido (até 400 dias)';
  end if;
  select timezone into v_tz from public.salons where id = p_salon_id;
  v_start := p_from::timestamp at time zone v_tz;
  v_end := (p_to + 1)::timestamp at time zone v_tz;

  select coalesce(sum(total), 0) into v_total from public.orders
  where salon_id = p_salon_id and status = 'fechada' and closed_at >= v_start and closed_at < v_end;
  select coalesce(sum(total), 0) into v_prev_total from public.orders
  where salon_id = p_salon_id and status = 'fechada'
    and closed_at >= (v_prev_from::timestamp at time zone v_tz) and closed_at < (p_from::timestamp at time zone v_tz);

  select coalesce(jsonb_agg(x order by (x -> 'current' ->> 'revenue')::numeric desc, x ->> 'name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'professional_id', p.id, 'name', p.name, 'color', p.color, 'active', p.active,
      'has_login', p.user_id is not null,
      'current', cur.m, 'previous_revenue', (prev.m ->> 'revenue')::numeric,
      'share', case when v_total > 0 then round((cur.m ->> 'revenue')::numeric / v_total, 4) end,
      'commission_share', case when (cur.m ->> 'revenue')::numeric > 0
                               then round((cur.m ->> 'commissions')::numeric / (cur.m ->> 'revenue')::numeric, 4) end
    ) as x
    from public.professionals p
    cross join lateral (select public.professional_period(p_salon_id, p.id, p_from, p_to) as m) cur
    cross join lateral (select public.professional_period(p_salon_id, p.id, v_prev_from, v_prev_to) as m) prev
    where p.salon_id = p_salon_id
      and (p.active or (cur.m ->> 'revenue')::numeric > 0 or (cur.m ->> 'commissions')::numeric <> 0)
  ) t;

  select coalesce(sum((r -> 'current' ->> 'revenue')::numeric), 0) into v_assigned
  from jsonb_array_elements(v_rows) r;

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', v_total,
    'previous_revenue', v_prev_total,
    'unassigned_revenue', round(v_total - v_assigned, 2),
    'professionals', v_rows
  );
end $$;

-- ---------------------------------------------------------------------
-- Permissões das funções
-- ---------------------------------------------------------------------
revoke execute on function public.professional_period(uuid, uuid, date, date) from public, anon, authenticated;
revoke execute on function public.commission_rates(uuid) from public, anon;
revoke execute on function public.professional_panel(uuid, date, date, uuid) from public, anon;
revoke execute on function public.team_report(uuid, date, date) from public, anon;
grant execute on function public.commission_rates(uuid) to authenticated;
grant execute on function public.professional_panel(uuid, date, date, uuid) to authenticated;
grant execute on function public.team_report(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
