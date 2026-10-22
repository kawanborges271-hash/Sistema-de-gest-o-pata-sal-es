-- =====================================================================
-- Salon OS · 014 · Demonstração da Fase 4
-- Fidelidade ligada (pontos das comandas pagas, alguns resgates, três
-- indicações) e lançamentos de marketing dos últimos três meses.
-- =====================================================================

alter function public.seed_demo_salon(uuid) rename to seed_demo_salon_fase3;
revoke execute on function public.seed_demo_salon_fase3(uuid) from public, anon, authenticated;

create or replace function public.seed_demo_salon(p_salon_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_month date;
  v_clients uuid[];
  r record;
  i int;
begin
  perform public.seed_demo_salon_fase3(p_salon_id);   -- checa admin e salão vazio
  perform setseed(0.47);
  select timezone into v_tz from public.salons where id = p_salon_id;

  update public.salons
     set loyalty_enabled = true, loyalty_points_per_real = 1, referral_enabled = true, referral_credit = 20
   where id = p_salon_id;

  insert into public.loyalty_rewards (salon_id, service_id, points_cost)
  select p_salon_id, s.id, x.cost
  from public.services s
  join (values ('Escova', 600), ('Design de sobrancelha', 400), ('Hidratação', 900), ('Manicure', 300)) x(name, cost)
    on x.name = s.name
  where s.salon_id = p_salon_id;

  -- Três indicações: a cliente indicada já pagou a primeira comanda
  select array_agg(id order by created_at, id) into v_clients from public.clients where salon_id = p_salon_id;
  for i in 1..3 loop
    update public.clients set referred_by_client_id = v_clients[i], origin = 'indicacao'
     where id = v_clients[i + 10];
  end loop;

  -- Pontos de todas as comandas pagas (1 ponto por real), na data da comanda
  insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, note, created_by, created_at)
  select o.salon_id, o.client_id, 'pontos', floor(o.total), 'compra', o.id, 'Comanda #' || o.number, null, o.closed_at
  from public.orders o
  where o.salon_id = p_salon_id and o.status = 'fechada' and o.client_id is not null and o.total >= 1;

  -- Crédito para quem indicou
  insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, referred_client_id, note, created_by, created_at)
  select c.salon_id, c.referred_by_client_id, 'credito', 20, 'indicacao', f.id, c.id, 'Indicou ' || c.name, null, f.closed_at
  from public.clients c
  cross join lateral (select o.id, o.closed_at from public.orders o
                      where o.client_id = c.id and o.status = 'fechada' order by o.closed_at limit 1) f
  where c.salon_id = p_salon_id and c.referred_by_client_id is not null;

  -- Alguns resgates de escova nas últimas semanas
  for r in
    select b.client_id, b.points, rw.id as reward_id, rw.points_cost, s.name
    from public.client_loyalty_balance b
    join public.loyalty_rewards rw on rw.salon_id = p_salon_id
    join public.services s on s.id = rw.service_id and s.name = 'Escova'
    where b.salon_id = p_salon_id and b.points >= rw.points_cost
    order by b.points desc
    limit 4
  loop
    insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, reward_id, note, created_by, created_at)
    values (p_salon_id, r.client_id, 'pontos', -r.points_cost, 'resgate', r.reward_id, 'Resgate · ' || r.name, null,
            now() - make_interval(days => 3 + floor(random() * 20)::int));
  end loop;

  -- Marketing: lançamentos dos últimos 3 meses (os anteriores ficam sem lançamento)
  for i in 0..2 loop
    v_month := (date_trunc('month', now() at time zone v_tz) - make_interval(months => i))::date;
    insert into public.marketing_entries (salon_id, month, channel, investment, notes, created_by)
    values
      (p_salon_id, v_month, 'meta_ads', 600 + 100 * (2 - i), 'Campanha de mensagens no Instagram/Facebook', null),
      (p_salon_id, v_month, 'google', 300, 'Google Ads + Perfil da Empresa', null),
      (p_salon_id, v_month, 'instagram', 150, 'Impulsionamento de posts', null),
      (p_salon_id, v_month, 'indicacao', 60, 'Crédito pago às clientes que indicaram', null);
  end loop;
end $$;

revoke execute on function public.seed_demo_salon(uuid) from public, anon;
grant execute on function public.seed_demo_salon(uuid) to authenticated;
