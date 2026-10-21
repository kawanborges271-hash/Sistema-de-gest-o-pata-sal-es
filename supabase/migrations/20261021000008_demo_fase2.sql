-- =====================================================================
-- Salon OS · 008 · Demonstração da Fase 2
-- seed_demo_salon passa a gerar também produtos, consumo por serviço,
-- pacotes, um caixa por dia com as comandas dos atendimentos concluídos,
-- comissões (parte já acertada) e o caixa de hoje aberto.
-- =====================================================================

alter function public.seed_demo_salon(uuid) rename to seed_demo_salon_base;
revoke execute on function public.seed_demo_salon_base(uuid) from public, anon, authenticated;

create or replace function public.seed_demo_salon(p_salon_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  v_pm record;
  m_dinheiro uuid; m_pix uuid; m_debito uuid; m_credito uuid;
  pr_shampoo uuid; pr_mascara uuid; pr_oleo uuid; pr_esmalte uuid;
  pr_tinta uuid; pr_oxi uuid; pr_esmalte_uso uuid; pr_henna uuid;
  pk_escova uuid; pk_maos uuid;
  v_day date;
  v_session uuid;
  v_appt record;
  v_order uuid;
  v_total numeric;
  v_r float;
  v_pay jsonb;
  v_first_client uuid;
  v_ana uuid;
begin
  perform public.seed_demo_salon_base(p_salon_id);   -- checa admin e salão vazio
  perform setseed(0.24);
  select timezone into v_tz from public.salons where id = p_salon_id;

  for v_pm in select id, kind from public.payment_methods where salon_id = p_salon_id loop
    case v_pm.kind
      when 'dinheiro' then m_dinheiro := v_pm.id;
      when 'pix' then m_pix := v_pm.id;
      when 'debito' then m_debito := v_pm.id;
      when 'credito' then m_credito := v_pm.id;
      else null;
    end case;
  end loop;

  -- Produtos: revenda (embalagem = 1 un) e uso interno (estoque em g/ml)
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, sale_price, commission_pct, min_stock)
    values (p_salon_id, 'Shampoo reconstrutor 300ml', 'Lumière', 'un', 1, true, false, 42, 89, 10, 4) returning id into pr_shampoo;
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, sale_price, commission_pct, min_stock)
    values (p_salon_id, 'Máscara de hidratação 250g', 'Lumière', 'un', 1, true, false, 48, 99, 10, 4) returning id into pr_mascara;
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, sale_price, commission_pct, min_stock)
    values (p_salon_id, 'Óleo finalizador 60ml', 'Argan Gold', 'un', 1, true, false, 30, 69, 10, 3) returning id into pr_oleo;
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, sale_price, commission_pct, min_stock)
    values (p_salon_id, 'Esmalte cremoso', 'Cor & Arte', 'un', 1, true, false, 6, 15, 10, 10) returning id into pr_esmalte;
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, min_stock)
    values (p_salon_id, 'Coloração creme 60g', 'Lumière Color', 'g', 60, false, true, 28, 600) returning id into pr_tinta;
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, min_stock)
    values (p_salon_id, 'Oxidante 20 vol 900ml', 'Lumière Color', 'ml', 900, false, true, 35, 900) returning id into pr_oxi;
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, min_stock)
    values (p_salon_id, 'Esmalte (uso) 8ml', 'Cor & Arte', 'ml', 8, false, true, 6, 40) returning id into pr_esmalte_uso;
  insert into public.products (salon_id, name, brand, unit, package_size, for_sale, for_use, cost_price, min_stock)
    values (p_salon_id, 'Henna para sobrancelha 2g', 'Brow Pro', 'g', 2, false, true, 25, 4) returning id into pr_henna;

  insert into public.service_supplies (salon_id, service_id, product_id, quantity)
  select p_salon_id, s.id, x.product_id, x.qty
  from public.services s
  join (values ('Coloração', pr_tinta, 60::numeric), ('Coloração', pr_oxi, 90),
               ('Mechas', pr_tinta, 60), ('Mechas', pr_oxi, 120),
               ('Manicure', pr_esmalte_uso, 0.5), ('Pedicure', pr_esmalte_uso, 0.5),
               ('Esmaltação em gel', pr_esmalte_uso, 0.8), ('Design com henna', pr_henna, 0.2)) x(service_name, product_id, qty)
    on x.service_name = s.name
  where s.salon_id = p_salon_id;

  -- Compra inicial (45 dias atrás); alguns itens já abaixo do mínimo hoje
  insert into public.stock_movements (salon_id, product_id, kind, quantity, notes, created_at)
  values
    (p_salon_id, pr_shampoo, 'entrada', 12, 'Compra inicial', now() - interval '45 days'),
    (p_salon_id, pr_mascara, 'entrada', 8, 'Compra inicial', now() - interval '45 days'),
    (p_salon_id, pr_oleo, 'entrada', 12, 'Compra inicial', now() - interval '45 days'),
    (p_salon_id, pr_esmalte, 'entrada', 30, 'Compra inicial', now() - interval '45 days'),
    (p_salon_id, pr_tinta, 'entrada', 60 * 30, 'Compra inicial (30 bisnagas)', now() - interval '45 days'),
    (p_salon_id, pr_oxi, 'entrada', 900 * 5, 'Compra inicial (5 frascos)', now() - interval '45 days'),
    (p_salon_id, pr_esmalte_uso, 'entrada', 8 * 12, 'Compra inicial (12 vidros)', now() - interval '45 days'),
    (p_salon_id, pr_henna, 'entrada', 2 * 4, 'Compra inicial (4 potes)', now() - interval '45 days'),
    (p_salon_id, pr_shampoo, 'entrada', 6, 'Reposição', now() - interval '20 days'),
    (p_salon_id, pr_mascara, 'entrada', 6, 'Reposição', now() - interval '20 days'),
    (p_salon_id, pr_esmalte, 'entrada', 12, 'Reposição', now() - interval '20 days');

  -- Pacotes
  insert into public.packages (salon_id, name, description, price, validity_days)
    values (p_salon_id, '4 escovas', 'Quatro escovas para usar em até 60 dias', 240, 60) returning id into pk_escova;
  insert into public.package_items (salon_id, package_id, service_id, sessions)
  select p_salon_id, pk_escova, id, 4 from public.services where salon_id = p_salon_id and name = 'Escova';

  insert into public.packages (salon_id, name, description, price, validity_days)
    values (p_salon_id, 'Mãos e pés · 4 vezes', 'Manicure + pedicure, 4 sessões de cada', 290, 90) returning id into pk_maos;
  insert into public.package_items (salon_id, package_id, service_id, sessions)
  select p_salon_id, pk_maos, id, 4 from public.services where salon_id = p_salon_id and name in ('Manicure', 'Pedicure');

  -- Um caixa por dia de atendimento, com as comandas dos concluídos
  for v_day in
    select distinct (a.starts_at at time zone v_tz)::date
    from public.appointments a
    where a.salon_id = p_salon_id and a.status = 'concluido'
    order by 1
  loop
    insert into public.cash_sessions (salon_id, opened_by, opened_at, opening_amount)
    values (p_salon_id, auth.uid(), (v_day + time '08:45') at time zone v_tz, 200)
    returning id into v_session;

    -- 1º dia das últimas 6 semanas: a cliente que mais faz escova compra o pacote
    if v_first_client is null and v_day >= current_date - 42 then
      select a.client_id into v_first_client
      from public.appointments a
      join public.appointment_items i on i.appointment_id = a.id
      join public.services s on s.id = i.service_id
      where a.salon_id = p_salon_id and a.status = 'concluido' and s.name = 'Escova' and a.starts_at >= now() - interval '42 days'
      group by a.client_id order by count(*) desc limit 1;
      insert into public.orders (salon_id, client_id, notes) values (p_salon_id, v_first_client, 'Compra de pacote')
      returning id into v_order;
      insert into public.order_items (salon_id, order_id, kind, package_id) values (p_salon_id, v_order, 'pacote', pk_escova);
      perform public.close_order_internal(v_order,
        jsonb_build_array(jsonb_build_object('payment_method_id', m_credito, 'amount', 240, 'installments', 2)),
        (v_day + time '09:00') at time zone v_tz, v_session);
    end if;

    for v_appt in
      select a.id, a.ends_at, a.client_id from public.appointments a
      where a.salon_id = p_salon_id and a.status = 'concluido'
        and (a.starts_at at time zone v_tz)::date = v_day
        and a.ends_at <= now()
      order by a.starts_at
    loop
      v_order := public.open_order_for_appointment(v_appt.id);

      -- 1 em cada 12 leva um produto, vendido por quem atendeu
      if random() < 0.08 then
        insert into public.order_items (salon_id, order_id, kind, product_id, professional_id)
        select p_salon_id, v_order, 'produto',
               (array[pr_shampoo, pr_mascara, pr_oleo, pr_esmalte])[1 + floor(random() * 4)::int],
               (select professional_id from public.order_items where order_id = v_order and kind = 'servico' limit 1);
      end if;
      -- de vez em quando, um desconto de fidelidade
      if random() < 0.08 then
        update public.orders set discount_amount = least(subtotal, 10), discount_reason = 'Fidelidade' where id = v_order;
      end if;

      select total into v_total from public.orders where id = v_order;
      v_r := random();
      v_pay := case
        when v_total = 0 then '[]'::jsonb
        when v_r < 0.38 then jsonb_build_array(jsonb_build_object('payment_method_id', m_pix, 'amount', v_total))
        when v_r < 0.62 then jsonb_build_array(jsonb_build_object('payment_method_id', m_credito, 'amount', v_total,
                                               'installments', case when v_total > 200 then 3 else 1 end))
        when v_r < 0.80 then jsonb_build_array(jsonb_build_object('payment_method_id', m_debito, 'amount', v_total))
        when v_r < 0.95 then jsonb_build_array(jsonb_build_object('payment_method_id', m_dinheiro, 'amount', v_total))
        else jsonb_build_array(jsonb_build_object('payment_method_id', m_dinheiro, 'amount', round(v_total / 2, 2)),
                               jsonb_build_object('payment_method_id', m_pix, 'amount', v_total - round(v_total / 2, 2)))
      end;
      perform public.close_order_internal(v_order, v_pay, v_appt.ends_at + interval '5 minutes', v_session);
    end loop;

    if random() < 0.3 then
      insert into public.cash_movements (salon_id, cash_session_id, kind, amount, description, created_at)
      values (p_salon_id, v_session, 'despesa', 18 + floor(random() * 40), 'Café e copos', (v_day + time '15:00') at time zone v_tz);
    end if;

    if v_day < (now() at time zone v_tz)::date then
      update public.cash_sessions
         set closed_at = (v_day + time '19:30') at time zone v_tz,
             closed_by = auth.uid(),
             expected_amount = public.cash_session_expected(v_session),
             counted_amount = public.cash_session_expected(v_session) - case when random() < 0.15 then 5 else 0 end
       where id = v_session;
      update public.cash_sessions set difference = counted_amount - expected_amount where id = v_session;
    end if;
  end loop;

  -- Caixa de hoje aberto, para já testar o fechamento de comandas
  if not exists (select 1 from public.cash_sessions where salon_id = p_salon_id and closed_at is null) then
    insert into public.cash_sessions (salon_id, opened_by, opened_at, opening_amount)
    values (p_salon_id, auth.uid(), least(now(), ((now() at time zone v_tz)::date + time '08:45') at time zone v_tz), 200);
  end if;

  -- Comissões acertadas até 15 dias atrás (ficam pendentes as das últimas 2 semanas)
  for v_ana in select id from public.professionals where salon_id = p_salon_id loop
    if exists (select 1 from public.commissions where professional_id = v_ana and status = 'pendente'
               and competence_date <= current_date - 15) then
      v_order := public.pay_commissions(v_ana, current_date - 15, 'Pix', 'Acerto quinzenal', false);
      update public.commission_payouts set paid_at = now() - interval '14 days' where id = v_order;
    end if;
  end loop;
end $$;

revoke execute on function public.seed_demo_salon(uuid) from public, anon;
grant execute on function public.seed_demo_salon(uuid) to authenticated;
