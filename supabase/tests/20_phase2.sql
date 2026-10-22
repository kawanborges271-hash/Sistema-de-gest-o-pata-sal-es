-- Testes da Fase 2: comandas, caixa, estoque, pacotes e comissões.
-- Roda depois de 10_phase1.sql (usa o salão de demonstração e os usuários de lá).

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

-- Reativa o salão A (o fim da Fase 1 testa a suspensão)
select pg_temp.as_postgres();
update public.salons set suspended_at = null where slug = 'studio-bela-flor';
select id as sa from public.salons where slug = 'studio-bela-flor' \gset
select id as sb from public.salons where slug = 'barbearia-do-ze' \gset
select id as ana from public.professionals where salon_id = :'sa' and name = 'Ana Souza' \gset
select id as bia from public.professionals where salon_id = :'sa' and name = 'Bia Martins' \gset
select id as mani from public.services where salon_id = :'sa' and name = 'Manicure' \gset
select id as escova from public.services where salon_id = :'sa' and name = 'Escova' \gset
select id as corte from public.services where salon_id = :'sa' and name = 'Corte feminino' \gset
select id as shampoo from public.products where salon_id = :'sa' and name like 'Shampoo%' \gset
select id as pk_escova from public.packages where salon_id = :'sa' and name = '4 escovas' \gset
select id as m_pix from public.payment_methods where salon_id = :'sa' and kind = 'pix' \gset
select id as m_cred from public.payment_methods where salon_id = :'sa' and kind = 'credito' \gset
select id as m_din from public.payment_methods where salon_id = :'sa' and kind = 'dinheiro' \gset
select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 18) + time '15:00') at time zone 'America/Sao_Paulo' as sexta_15 \gset

-- Demonstração da Fase 2
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.orders where salon_id = :'sa' and status = 'fechada') > 100, 'demo: comandas fechadas do histórico');
select pg_temp.check((select count(*) from public.cash_sessions where salon_id = :'sa' and closed_at is not null) > 20, 'demo: um caixa por dia');
select pg_temp.check((select count(*) from public.commissions where salon_id = :'sa' and status = 'paga') > 0
  and (select count(*) from public.commissions where salon_id = :'sa' and status = 'pendente') > 0, 'demo: comissões pagas e pendentes');
select pg_temp.check((select count(*) from public.stock_movements where salon_id = :'sa' and kind = 'uso') > 0, 'demo: consumo de produto pelos serviços');

-- Outro salão já nasce com formas de pagamento e não vê nada de A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.payment_methods where salon_id = :'sb') = 4, 'salão novo nasce com 4 formas de pagamento');
select pg_temp.check((select count(*) from public.orders where salon_id = :'sa') = 0, 'B não lê comandas de A');
select pg_temp.check((select count(*) from public.commissions) = 0, 'B não lê comissões de A');
insert into public.orders (salon_id) values (:'sb') returning id as ob \gset
select pg_temp.expect_error(format($q$insert into public.order_items (salon_id, order_id, kind, product_id) values (%L, %L, 'produto', %L)$q$,
  :'sb', :'ob', :'shampoo'), '%nválido%');

-- Recepção: fecha o caixa do dia da demonstração
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select id as sess0 from public.cash_sessions where salon_id = :'sa' and closed_at is null \gset
select pg_temp.check(public.close_cash_session(:'sess0', public.cash_session_expected(:'sess0')) = 0, 'fechar caixa com o valor esperado: diferença zero');

insert into public.clients (salon_id, name) values (:'sa', 'Cliente Fase 2') returning id as cli \gset
select public.create_appointment(:'sa', :'cli', jsonb_build_array(
  jsonb_build_object('service_id', :'mani', 'professional_id', :'bia', 'starts_at', :'sexta_15', 'is_squeeze', true))) as apf \gset

-- Comanda a partir do agendamento
select public.open_order_for_appointment(:'apf') as o1 \gset
select pg_temp.check((select subtotal from public.orders where id = :'o1') = 40, 'comanda traz o serviço do agendamento');
select pg_temp.check(public.open_order_for_appointment(:'apf') = :'o1', 'abrir de novo reaproveita a mesma comanda');
insert into public.order_items (salon_id, order_id, kind, product_id, professional_id) values (:'sa', :'o1', 'produto', :'shampoo', :'bia');
select pg_temp.check((select subtotal from public.orders where id = :'o1') = 129, 'produto entra com o preço de venda');

select pg_temp.expect_error(format($q$select public.close_order(%L, jsonb_build_array(jsonb_build_object('payment_method_id', %L, 'amount', 129)))$q$,
  :'o1', :'m_pix'), 'CAIXA_FECHADO%');
select public.open_cash_session(:'sa', 100) as sess \gset
select pg_temp.expect_error(format('select public.open_cash_session(%L, 0)', :'sa'), '%caixa aberto%');
select pg_temp.expect_error(format($q$select public.close_order(%L, jsonb_build_array(jsonb_build_object('payment_method_id', %L, 'amount', 100)))$q$,
  :'o1', :'m_pix'), 'PAGAMENTO_DIFERENTE%');
select pg_temp.expect_error(format($q$select public.close_order(%L, jsonb_build_array(jsonb_build_object('payment_method_id', %L, 'amount', 129, 'installments', 12)))$q$,
  :'o1', :'m_cred'), '%parcela%');

select current_stock as s0 from public.products where id = :'shampoo' \gset
select public.close_order(:'o1', jsonb_build_array(
  jsonb_build_object('payment_method_id', :'m_din', 'amount', 29),
  jsonb_build_object('payment_method_id', :'m_cred', 'amount', 100, 'installments', 2)));
select pg_temp.check((select status from public.orders where id = :'o1') = 'fechada', 'comanda fechada com dois pagamentos');
select pg_temp.check((select status from public.appointments where id = :'apf') = 'concluido', 'fechar a comanda conclui o agendamento');
select pg_temp.check((select current_stock from public.products where id = :'shampoo') = :s0 - 1, 'venda baixa o estoque');
select pg_temp.check((select fee_total from public.orders where id = :'o1') = 4.99, 'taxa do crédito 2x (3,49% + 1,5%)');
select pg_temp.check((select count(*) from public.commissions) = 0, 'recepção não lê comissões');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select amount from public.commissions where order_id = :'o1' and description = 'Manicure') = 20, 'comissão de 50% da Bia sobre a manicure');
select pg_temp.check((select amount from public.commissions where order_id = :'o1' and description like 'Shampoo%') = 8.90, 'comissão de 10% sobre o produto');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');

-- Comanda fechada não muda
select pg_temp.expect_error(format($q$insert into public.order_items (salon_id, order_id, kind, product_id) values (%L, %L, 'produto', %L)$q$,
  :'sa', :'o1', :'shampoo'), '%fechada%');
select pg_temp.expect_error(format('update public.orders set discount_amount = 5 where id = %L', :'o1'), '%não pode ser alterada%');
select pg_temp.expect_error(format($q$update public.orders set status = 'aberta' where id = %L$q$, :'o1'), '42501');
select pg_temp.expect_error(format($q$insert into public.order_payments (salon_id, order_id, payment_method_id, kind, amount, cash_session_id) values (%L, %L, %L, 'pix', 1, %L)$q$,
  :'sa', :'o1', :'m_pix', :'sess'), '42501');
select pg_temp.check(true, 'status e pagamentos só mudam pelas funções');

-- Estoque: recepção lança entrada, não ajusta, e saldo não se edita
insert into public.stock_movements (salon_id, product_id, kind, quantity, notes) values (:'sa', :'shampoo', 'entrada', 5, 'Compra');
select pg_temp.check((select current_stock from public.products where id = :'shampoo') = :s0 + 4, 'entrada soma no estoque');
select pg_temp.expect_error(format($q$insert into public.stock_movements (salon_id, product_id, kind, quantity) values (%L, %L, 'ajuste', -1)$q$,
  :'sa', :'shampoo'), '%row-level security%');
select pg_temp.expect_error(format($q$insert into public.stock_movements (salon_id, product_id, kind, quantity) values (%L, %L, 'venda', -1)$q$,
  :'sa', :'shampoo'), '%row-level security%');
select pg_temp.expect_error(format('update public.products set current_stock = 999 where id = %L', :'shampoo'), '42501');
select pg_temp.check(true, 'saldo só muda por movimentação');

select pg_temp.expect_error(format($q$select public.cancel_order(%L, 'teste')$q$, :'o1'), '%administrador%');
select pg_temp.expect_error(format($q$select public.pay_commissions(%L, current_date)$q$, :'bia'), '%administrador%');

-- Profissional: não vê comandas nem caixa; vê só as próprias comissões
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.orders) = 0, 'Ana não lê comandas');
select pg_temp.check((select count(*) from public.cash_sessions) = 0, 'Ana não lê o caixa');
select pg_temp.check((select count(*) from public.commissions) > 0 and (select count(*) from public.commissions where professional_id <> :'ana') = 0,
  'Ana vê só as próprias comissões');
select pg_temp.expect_error(format($q$select public.close_order(%L)$q$, :'o1'), '%não encontrada%');

-- Admin cancela a comanda fechada: estorna dinheiro, estoque e comissões
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.cancel_order(:'o1', 'Cliente devolveu o produto');
select pg_temp.check((select current_stock from public.products where id = :'shampoo') = :s0 + 5, 'cancelamento devolve o estoque');
select pg_temp.check((select count(*) from public.commissions where order_id = :'o1' and status = 'estornada') = 2, 'comissões pendentes estornadas');
select pg_temp.check((select amount from public.cash_movements where order_id = :'o1' and kind = 'estorno') = 29, 'dinheiro devolvido sai da gaveta');
select pg_temp.check(public.cash_session_expected(:'sess') = 100, 'esperado no caixa: abertura + dinheiro − estorno');

-- Comissão sobre o líquido, descontando a taxa da maquininha
update public.salons set commission_base = 'liquido', commission_deduct_card_fee = true where id = :'sa';
insert into public.orders (salon_id, client_id) values (:'sa', :'cli') returning id as o2 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o2', 'servico', :'mani', :'bia');
select public.close_order(:'o2', jsonb_build_array(jsonb_build_object('payment_method_id', :'m_cred', 'amount', 40)));
select pg_temp.check((select base_amount from public.commissions where order_id = :'o2') = 38.60
  and (select amount from public.commissions where order_id = :'o2') = 19.30, 'base líquida = 40 − taxa de 1,40');
update public.salons set commission_base = 'bruto', commission_deduct_card_fee = false where id = :'sa';

-- Desconto da comanda reduz a base da comissão
insert into public.orders (salon_id, client_id, discount_amount, discount_reason) values (:'sa', :'cli', 20, 'Aniversário') returning id as o6 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id) values (:'sa', :'o6', 'servico', :'corte', :'ana');
select pg_temp.check((select total from public.orders where id = :'o6') = 100, 'total = 120 − 20 de desconto');
select public.close_order(:'o6', jsonb_build_array(jsonb_build_object('payment_method_id', :'m_pix', 'amount', 100)));
select pg_temp.check((select amount from public.commissions where order_id = :'o6') = 40, '40% da Ana sobre 100');

-- Pacote: venda e uso de sessão
insert into public.orders (salon_id, client_id) values (:'sa', :'cli') returning id as o3 \gset
insert into public.order_items (salon_id, order_id, kind, package_id) values (:'sa', :'o3', 'pacote', :'pk_escova');
select public.close_order(:'o3', jsonb_build_array(jsonb_build_object('payment_method_id', :'m_pix', 'amount', 240)));
select balance_id as bal from public.client_package_overview where client_id = :'cli' and service_id = :'escova' \gset
select pg_temp.check((select sessions_left from public.client_package_overview where balance_id = :'bal') = 4, 'pacote vendido: 4 escovas');

insert into public.orders (salon_id, client_id) values (:'sa', :'cli') returning id as o4 \gset
insert into public.order_items (salon_id, order_id, kind, service_id, professional_id, client_package_balance_id)
  values (:'sa', :'o4', 'servico', :'escova', :'ana', :'bal');
select pg_temp.check((select total from public.orders where id = :'o4') = 0, 'sessão de pacote não cobra de novo');
select public.close_order(:'o4');
select pg_temp.check((select sessions_used from public.client_package_balances where id = :'bal') = 1, 'sessão usada');
select pg_temp.check((select base_amount from public.commissions where order_id = :'o4') = 60, 'comissão da sessão sobre o valor rateado (240/4)');
select pg_temp.expect_error(format($q$select public.cancel_order(%L, 'teste')$q$, :'o3'), '%já foi usado%');

insert into public.clients (salon_id, name) values (:'sa', 'Outra Cliente') returning id as cli_outra \gset
insert into public.orders (salon_id, client_id) values (:'sa', :'cli_outra') returning id as o5 \gset
select pg_temp.expect_error(format($q$insert into public.order_items (salon_id, order_id, kind, service_id, professional_id, client_package_balance_id) values (%L, %L, 'servico', %L, %L, %L)$q$,
  :'sa', :'o5', :'escova', :'ana', :'bal'), '%não é desta cliente%');

-- Acerto de comissão e estorno de comissão já paga
select public.pay_commissions(:'bia', current_date, 'Pix') as payout \gset
select pg_temp.check((select count(*) from public.commissions where professional_id = :'bia' and status = 'pendente') = 0, 'acerto paga tudo até a data');
select pg_temp.check((select total from public.commission_payouts where id = :'payout') > 0, 'acerto registra o total');
select public.cancel_order(:'o2', 'Cobrança em duplicidade');
select pg_temp.check((select amount from public.commissions where order_id = :'o2' and reversal_of_id is not null) = -19.30,
  'comissão já paga vira lançamento negativo para o próximo acerto');

-- Fechamento do caixa com diferença
select pg_temp.check(public.close_cash_session(:'sess', 90) = -10, 'faltaram R$ 10 na gaveta');
select pg_temp.check((select difference from public.cash_session_summary where cash_session_id = :'sess') = -10, 'resumo do caixa mostra a diferença');
select pg_temp.check((select count(*) from public.audit_log where table_name = 'orders' and record_id = :'o1') >= 3, 'auditoria das comandas');

select pg_temp.as_postgres();
