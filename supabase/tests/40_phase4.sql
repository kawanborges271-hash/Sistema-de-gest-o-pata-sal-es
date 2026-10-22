-- Testes da Fase 4: dashboard, marketing, inteligência e fidelidade.
-- Roda depois de 30_phase3.sql (usa o salão de demonstração e os usuários de lá).

\set ON_ERROR_STOP 1

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like and sqlstate not like p_like then
      raise exception 'Erro diferente do esperado. Esperava %, veio % (%)', p_like, sqlerrm, sqlstate;
    end if;
    return;
  end;
  raise exception 'Esperava erro % e não houve: %', p_like, p_sql;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FALHOU: %', p_msg; end if;
  raise notice 'ok  %', p_msg;
end $$;

\set admin '00000000-0000-0000-0000-00000000000a'
\set dono_b '00000000-0000-0000-0000-00000000000b'
\set rec '00000000-0000-0000-0000-00000000000c'
\set prof '00000000-0000-0000-0000-00000000000d'
\set intrusa '00000000-0000-0000-0000-00000000000e'

select pg_temp.as_postgres();
select id as sa from public.salons where slug = 'studio-bela-flor' \gset
select id as sb from public.salons where slug = 'barbearia-do-ze' \gset
select timezone as tz from public.salons where id = :'sa' \gset
select (now() at time zone :'tz')::date as hoje \gset
select id as ana from public.professionals where salon_id = :'sa' and name = 'Ana Souza' \gset
select id as bia from public.professionals where salon_id = :'sa' and name = 'Bia Martins' \gset
select id as escova from public.services where salon_id = :'sa' and name = 'Escova' \gset
select price as escova_preco from public.services where id = :'escova' \gset
select id as mani from public.services where salon_id = :'sa' and name = 'Manicure' \gset
select id as m_pix from public.payment_methods where salon_id = :'sa' and kind = 'pix' \gset

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'admin');
select public.dashboard_summary(:'sa', (:'hoje'::date - 29), :'hoje'::date) as dash \gset
select pg_temp.check((:'dash'::jsonb -> 'current' ->> 'revenue')::numeric = (
  select coalesce(sum(total), 0) from public.orders where salon_id = :'sa' and status = 'fechada'
    and closed_at >= ((:'hoje'::date - 29)::timestamp at time zone :'tz') and closed_at < ((:'hoje'::date + 1)::timestamp at time zone :'tz')),
  'faturamento = soma das comandas pagas no período, no fuso do salão');
select pg_temp.check((:'dash'::jsonb -> 'current' ->> 'avg_ticket')::numeric
  = round((:'dash'::jsonb -> 'current' ->> 'revenue')::numeric / (:'dash'::jsonb -> 'current' ->> 'orders')::int, 2),
  'ticket médio = faturamento ÷ comandas');
select pg_temp.check((:'dash'::jsonb -> 'current' ->> 'attendance_rate')::numeric = round(
  (:'dash'::jsonb -> 'current' ->> 'attended')::numeric
  / ((:'dash'::jsonb -> 'current' ->> 'attended')::int + (:'dash'::jsonb -> 'current' ->> 'no_shows')::int), 4),
  'comparecimento = compareceram ÷ (compareceram + faltaram)');
select pg_temp.check((:'dash'::jsonb -> 'current' ->> 'occupancy')::numeric between 0.01 and 1
  and (:'dash'::jsonb -> 'current' ->> 'available_hours')::numeric > 0, 'ocupação entre 0 e 100% e horas disponíveis da jornada');
select pg_temp.check((:'dash'::jsonb -> 'previous' ->> 'to')::date = :'hoje'::date - 30
  and (:'dash'::jsonb -> 'previous' ->> 'from')::date = :'hoje'::date - 59, 'período anterior com o mesmo tamanho');
select pg_temp.check(jsonb_array_length(:'dash'::jsonb -> 'series') = 30 and :'dash'::jsonb ->> 'granularity' = 'dia', 'gráfico por dia');
select pg_temp.check((select sum((x ->> 'current')::numeric) from jsonb_array_elements(:'dash'::jsonb -> 'series') x)
  = (:'dash'::jsonb -> 'current' ->> 'revenue')::numeric, 'soma do gráfico = faturamento do período');
select pg_temp.check((:'dash'::jsonb -> 'current' ->> 'product_share')::numeric between 0 and 1, 'venda de produtos em % do faturamento');
select pg_temp.check((:'dash'::jsonb -> 'current' ->> 'commissions')::numeric > 0, 'comissões do período');
select pg_temp.check((:'dash'::jsonb -> 'current' ->> 'returning_clients')::int > 0, 'clientes que voltaram');
select pg_temp.check(jsonb_array_length(:'dash'::jsonb -> 'upcoming') between 1 and 8, 'próximos agendamentos');
select pg_temp.check(public.dashboard_summary(:'sa', (:'hoje'::date - 89), :'hoje'::date) ->> 'granularity' = 'semana', 'acima de 62 dias o gráfico é por semana');
select pg_temp.check((select sum((x ->> 'current')::numeric) = (public.dashboard_summary(:'sa', (:'hoje'::date - 89), :'hoje'::date) -> 'current' ->> 'revenue')::numeric
                        and sum((x ->> 'previous')::numeric) = (public.dashboard_summary(:'sa', (:'hoje'::date - 89), :'hoje'::date) -> 'previous' ->> 'revenue')::numeric
                      from jsonb_array_elements(public.dashboard_summary(:'sa', (:'hoje'::date - 89), :'hoje'::date) -> 'series') x),
                     'semanas: barras somam o faturamento atual e o anterior');
select pg_temp.expect_error(format('select public.dashboard_summary(%L, %L, %L)', :'sa', :'hoje', (:'hoje'::date - 1)), '%Período inválido%');

-- aniversariante da semana
select pg_temp.as_postgres();
update public.clients set birth_date = (:'hoje'::date + 2) - interval '30 years'
 where id = (select id from public.clients where salon_id = :'sa' order by name limit 1);
select pg_temp.as_user(:'admin');
select pg_temp.check((select count(*) from jsonb_array_elements(public.dashboard_summary(:'sa', :'hoje'::date, :'hoje'::date) -> 'birthdays') b
  where (b ->> 'date')::date = :'hoje'::date + 2 and (b ->> 'age')::int = 30) = 1, 'aniversariante da semana com a idade que vai fazer');

select pg_temp.as_user(:'rec');
select pg_temp.expect_error(format('select public.dashboard_summary(%L, %L, %L)', :'sa', :'hoje', :'hoje'), '42501');
select pg_temp.as_user(:'dono_b');
select pg_temp.expect_error(format('select public.dashboard_summary(%L, %L, %L)', :'sa', :'hoje', :'hoje'), '42501');

-- ---------------------------------------------------------------------
-- Marketing & Vendas
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'admin');
select date_trunc('month', now() at time zone :'tz')::date as mes \gset
select pg_temp.check((select count(*) from public.marketing_entries where salon_id = :'sa') = 12, 'demo: 3 meses de lançamentos por canal');
select pg_temp.check((select count(*) from public.marketing_report(:'sa', 12)) = 48, '12 meses × 4 canais');
select pg_temp.check((select count(*) from public.marketing_report(:'sa', 12) where not has_entry) = 36, 'meses sem lançamento ficam marcados');
select pg_temp.check((select revenue from public.marketing_report(:'sa', 3) where month = :'mes' and channel = 'instagram')
  = (select coalesce(sum(o.total), 0) from public.orders o join public.clients c on c.id = o.client_id
     where o.salon_id = :'sa' and o.status = 'fechada' and c.origin = 'instagram'
       and date_trunc('month', o.closed_at at time zone :'tz')::date = :'mes'),
  'receita do canal = comandas pagas por clientes com essa origem');
update public.marketing_entries set leads = 42, revenue = 9999 where salon_id = :'sa' and month = :'mes' and channel = 'google';
select pg_temp.check((select leads = 42 and revenue = 9999 and auto_revenue is distinct from 9999
  from public.marketing_report(:'sa', 3) where month = :'mes' and channel = 'google'), 'número lançado à mão vale sobre o calculado');
select pg_temp.expect_error(format($$insert into public.marketing_entries (salon_id, month, channel, investment) values (%L, %L, 'google', 10)$$, :'sa', :'mes'), '23505');
select pg_temp.expect_error(format($$insert into public.marketing_entries (salon_id, month, channel, investment) values (%L, %L, 'google', 10)$$, :'sa', (:'mes'::date + 3)), '23514');

select pg_temp.as_user(:'rec');
select pg_temp.check((select count(*) from public.marketing_entries) = 0, 'recepção não vê investimento');
select pg_temp.expect_error(format('select * from public.marketing_report(%L, 3)', :'sa'), '42501');
select pg_temp.as_user(:'dono_b');
select pg_temp.check((select count(*) from public.marketing_entries) = 0, 'outro salão não vê os lançamentos');

-- ---------------------------------------------------------------------
-- Inteligência
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'admin');
select public.intelligence_actions(:'sa') as acoes \gset
select pg_temp.check(jsonb_array_length(:'acoes'::jsonb) between 1 and 7, 'plano de ação com até 7 itens');
select pg_temp.check((select bool_and((a ->> 'rank')::int = n) from jsonb_array_elements(:'acoes'::jsonb) with ordinality t(a, n)), 'plano numerado em ordem');
select pg_temp.check((select bool_and(coalesce((a ->> 'impact')::numeric <= (lag ->> 'impact')::numeric, true)) from (
  select a, lag(a) over (order by (a ->> 'rank')::int) as lag from jsonb_array_elements(:'acoes'::jsonb) a) x),
  'oportunidades em ordem de impacto');
select pg_temp.check((select bool_and(a -> 'action' ->> 'type' in ('link', 'campaign')) from jsonb_array_elements(:'acoes'::jsonb) a), 'cada item tem a próxima ação');

select public.intelligence_report(:'sa', 90) as intel \gset
select pg_temp.check(jsonb_array_length(:'intel'::jsonb -> 'no_shows') = 7, 'faltas por dia da semana (7 dias)');
select pg_temp.check((select bool_and(coalesce((h ->> 'rate')::numeric, 0) between 0 and 1) and count(*) > 20
  from jsonb_array_elements(:'intel'::jsonb -> 'heatmap') h), 'mapa de ocupação por dia e hora');
select pg_temp.check(jsonb_array_length(:'intel'::jsonb -> 'professionals') = 3, 'desempenho das 3 profissionais');
select pg_temp.check((select bool_and((p ->> 'appointments')::int >= (p ->> 'attended')::int and (p ->> 'revenue')::numeric > 0)
  from jsonb_array_elements(:'intel'::jsonb -> 'professionals') p), 'profissional: agendados, comparecimento e faturamento');
select pg_temp.check((select (s ->> 'revenue')::numeric >= (:'intel'::jsonb -> 'services' -> 1 ->> 'revenue')::numeric
  from jsonb_array_elements(:'intel'::jsonb -> 'services') s limit 1), 'serviços em ordem de faturamento');

-- vieram uma vez e não voltaram
select pg_temp.as_postgres();
insert into public.clients (salon_id, name, phone) values (:'sa', 'Veio Uma Vez', '5511955550001') returning id as uma \gset
select ((:'hoje'::date - 45) + time '10:00') at time zone :'tz' as ha45 \gset
insert into public.appointments (salon_id, client_id, status, starts_at, ends_at)
values (:'sa', :'uma', 'concluido', :'ha45', :'ha45'::timestamptz + interval '1 hour') returning id as ap_uma \gset
insert into public.appointment_items (salon_id, appointment_id, service_id, professional_id, starts_at, ends_at, price, is_squeeze)
values (:'sa', :'ap_uma', :'mani', :'bia', :'ha45', :'ha45'::timestamptz + interval '1 hour', 50, true);
select pg_temp.as_user(:'rec');
select pg_temp.check(exists (select 1 from public.campaign_audience(:'sa', 'nao_voltaram') where client_id = :'uma'), 'lista "vieram e não voltaram"');
select pg_temp.check(not exists (select 1 from public.campaign_audience(:'sa', 'nao_voltaram') a
  join public.client_overview co on co.id = a.client_id where co.visits_count <> 1), 'só quem veio uma vez');
select pg_temp.expect_error(format('select public.intelligence_actions(%L)', :'sa'), '42501');

-- ---------------------------------------------------------------------
-- Fidelidade
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'admin');
select pg_temp.check((select count(*) from public.loyalty_ledger where salon_id = :'sa' and reason = 'compra') > 100, 'demo: pontos das comandas pagas');
select pg_temp.check((select count(*) from public.loyalty_ledger where salon_id = :'sa' and reason = 'indicacao') = 3, 'demo: três indicações');
select pg_temp.check(exists (select 1 from public.payment_methods where salon_id = :'sa' and loyalty_credit and active), 'forma de pagamento "Crédito de indicação"');
select id as rw_escova, points_cost as rw_custo from public.loyalty_rewards where salon_id = :'sa' and service_id = :'escova' \gset

-- Indicação: a indicada paga a primeira comanda e quem indicou ganha R$ 20
insert into public.clients (salon_id, name, phone) values (:'sa', 'Madrinha Fiel', '5511955550002') returning id as madrinha \gset
insert into public.clients (salon_id, name, phone, origin, referred_by_client_id)
values (:'sa', 'Afilhada Nova', '5511955550003', 'indicacao', :'madrinha') returning id as afilhada \gset

select pg_temp.as_user(:'rec');
select coalesce((select id from public.cash_sessions where salon_id = :'sa' and closed_at is null),
                public.open_cash_session(:'sa', 0)) as caixa \gset
insert into public.orders (salon_id, client_id) values (:'sa', :'afilhada') returning id as o1 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o1', 'servico', :'mani', :'bia');
select total as o1_total from public.orders where id = :'o1' \gset
select public.close_order(:'o1', jsonb_build_array(jsonb_build_object('payment_method_id', :'m_pix', 'amount', :'o1_total')));
select pg_temp.check((select points from public.client_loyalty_balance where client_id = :'afilhada') = floor(:'o1_total'::numeric), 'pontos = R$ pago × pontos por real');
select pg_temp.check((select credit from public.client_loyalty_balance where client_id = :'madrinha') = 20, 'quem indicou ganha o crédito na primeira comanda da indicada');

insert into public.orders (salon_id, client_id) values (:'sa', :'afilhada') returning id as o2 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o2', 'servico', :'mani', :'bia');
select public.close_order(:'o2', jsonb_build_array(jsonb_build_object('payment_method_id', :'m_pix', 'amount', :'o1_total')));
select pg_temp.check((select credit from public.client_loyalty_balance where client_id = :'madrinha') = 20, 'segunda comanda não gera nova indicação');

-- Crédito como pagamento
select id as m_cred_ind from public.payment_methods where salon_id = :'sa' and loyalty_credit \gset
insert into public.orders (salon_id, client_id) values (:'sa', :'madrinha') returning id as o3 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o3', 'servico', :'escova', :'ana');
select total as o3_total from public.orders where id = :'o3' \gset
select pg_temp.expect_error(format('select public.close_order(%L, %L::jsonb)', :'o3', jsonb_build_array(
  jsonb_build_object('payment_method_id', :'m_cred_ind', 'amount', 30),
  jsonb_build_object('payment_method_id', :'m_pix', 'amount', :'o3_total'::numeric - 30))), '%crédito de indicação%');
select pg_temp.check((select credit from public.client_loyalty_balance where client_id = :'madrinha') = 20, 'crédito insuficiente não desconta nada');
select public.close_order(:'o3', jsonb_build_array(
  jsonb_build_object('payment_method_id', :'m_cred_ind', 'amount', 20),
  jsonb_build_object('payment_method_id', :'m_pix', 'amount', :'o3_total'::numeric - 20)));
select pg_temp.check((select credit from public.client_loyalty_balance where client_id = :'madrinha') = 0, 'crédito usado na comanda');
select pg_temp.check((select points from public.client_loyalty_balance where client_id = :'madrinha') = floor(:'o3_total'::numeric - 20),
  'pontos não contam a parte paga com crédito');

-- Resgate: Escova por pontos
select pg_temp.expect_error(format('select public.adjust_loyalty(%L, %L, %s, %L)', :'afilhada', 'pontos', 1000, 'bônus'), '42501');
select pg_temp.as_user(:'admin');
select pg_temp.expect_error(format('select public.adjust_loyalty(%L, %L, %s, %L)', :'afilhada', 'pontos', 1000, ''), '%motivo%');
select public.adjust_loyalty(:'afilhada', 'pontos', 1000, 'Bônus de boas-vindas');
select points as pts0 from public.client_loyalty_balance where client_id = :'afilhada' \gset
select pg_temp.as_user(:'rec');
insert into public.orders (salon_id, client_id) values (:'sa', :'afilhada') returning id as o4 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o4', 'servico', :'escova', :'ana') returning id as it4 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o4', 'servico', :'mani', :'bia') returning id as it4m \gset
select pg_temp.expect_error(format('select public.redeem_loyalty_reward(%L, %L)', :'it4m', :'rw_escova'), '%outro serviço%');
select pg_temp.expect_error(format('update public.order_items set loyalty_reward_id = %L where id = %L', :'rw_escova', :'it4'), '%resgate%');
select public.redeem_loyalty_reward(:'it4', :'rw_escova');
select pg_temp.check((select total from public.order_items where id = :'it4') = 0, 'serviço resgatado sai de graça');
select pg_temp.check((select points from public.client_loyalty_balance where client_id = :'afilhada') = :'pts0'::int - :'rw_custo'::int, 'pontos saem do saldo');
select pg_temp.expect_error(format('select public.redeem_loyalty_reward(%L, %L)', :'it4', :'rw_escova'), '%já está pago%');
select pg_temp.expect_error(format('update public.order_items set discount_amount = 0 where id = %L', :'it4'), '%Desfaça o resgate%');
select public.undo_loyalty_redemption(:'it4');
select pg_temp.check((select points from public.client_loyalty_balance where client_id = :'afilhada') = :'pts0'::int
  and (select total from public.order_items where id = :'it4') > 0, 'desfazer o resgate devolve os pontos e o preço');
select public.redeem_loyalty_reward(:'it4', :'rw_escova');
delete from public.order_items where id = :'it4';
select pg_temp.check((select points from public.client_loyalty_balance where client_id = :'afilhada') = :'pts0'::int, 'item removido devolve os pontos');
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o4', 'servico', :'escova', :'ana') returning id as it4b \gset
select public.redeem_loyalty_reward(:'it4b', :'rw_escova');
select total as o4_total from public.orders where id = :'o4' \gset
select public.close_order(:'o4', jsonb_build_array(jsonb_build_object('payment_method_id', :'m_pix', 'amount', :'o4_total')));
select pg_temp.check((select points from public.client_loyalty_balance where client_id = :'afilhada')
  = :'pts0'::int - :'rw_custo'::int + floor(:'o4_total'::numeric), 'comanda com resgate fecha e gera pontos do que foi pago');

-- Cancelar comanda paga desfaz pontos, resgate e crédito
select pg_temp.as_user(:'admin');
select public.cancel_order(:'o4', 'Teste de estorno');
select pg_temp.check((select points from public.client_loyalty_balance where client_id = :'afilhada') = :'pts0'::int, 'cancelar comanda estorna pontos e devolve o resgate');
select public.cancel_order(:'o3', 'Teste de estorno do crédito');
select pg_temp.check((select credit from public.client_loyalty_balance where client_id = :'madrinha') = 20
  and (select points from public.client_loyalty_balance where client_id = :'madrinha') = 0, 'cancelar devolve o crédito de indicação e tira os pontos');
select public.cancel_order(:'o1', 'Teste de estorno da indicação');
select pg_temp.check((select credit from public.client_loyalty_balance where client_id = :'madrinha') = 0, 'cancelar a comanda que gerou a indicação tira o crédito');

select pg_temp.as_user(:'admin');
select pg_temp.check((public.loyalty_summary(:'sa') ->> 'clients_with_points')::int > 10, 'resumo do programa');
select pg_temp.as_user(:'intrusa');
select pg_temp.check((select count(*) from public.loyalty_ledger) = 0 and public.loyalty_summary(:'sa') is null, 'quem é de fora não vê o extrato');
select pg_temp.expect_error($$insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason) values ('$$ || :'sa' || $$', '$$ || :'madrinha' || $$', 'pontos', 1000, 'ajuste')$$, '42501');
select pg_temp.as_user(:'rec');
select pg_temp.expect_error($$insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason) values ('$$ || :'sa' || $$', '$$ || :'madrinha' || $$', 'pontos', 1000, 'ajuste')$$, '42501');
update public.loyalty_rewards set points_cost = 1 where id = :'rw_escova';
select pg_temp.check((select points_cost from public.loyalty_rewards where id = :'rw_escova') = :'rw_custo'::int, 'recepção não muda o custo do prêmio');

select pg_temp.as_postgres();
