-- =====================================================================
-- Salon OS · 007 · Comandas, caixa e comissões
--
-- Fluxo: abre a comanda (avulsa ou a partir do agendamento) → lança
-- serviços, produtos e pacotes → fecha com uma ou mais formas de pagamento.
-- O fechamento (close_order) faz tudo numa transação:
--   pagamentos no caixa aberto · baixa de estoque (venda e consumo dos
--   serviços) · uso/venda de pacotes · comissões · conclui o agendamento.
-- Comanda fechada não se edita; cancelar desfaz tudo com estornos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Formas de pagamento (com taxa da maquininha)
-- ---------------------------------------------------------------------
create type public.payment_kind as enum ('dinheiro', 'pix', 'debito', 'credito', 'voucher', 'outro');

create table public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  kind public.payment_kind not null,
  fee_pct numeric(5,2) not null default 0 check (fee_pct between 0 and 100),
  installment_fee_pct numeric(5,2) not null default 0 check (installment_fee_pct between 0 and 100),  -- por parcela além da 1ª
  max_installments smallint not null default 1 check (max_installments between 1 and 24),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, name)
);

create or replace function public.seed_payment_methods(p_salon_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.payment_methods (salon_id, name, kind, fee_pct, installment_fee_pct, max_installments, sort_order) values
    (p_salon_id, 'Dinheiro', 'dinheiro', 0, 0, 1, 1),
    (p_salon_id, 'Pix', 'pix', 0, 0, 1, 2),
    (p_salon_id, 'Débito', 'debito', 1.99, 0, 1, 3),
    (p_salon_id, 'Crédito', 'credito', 3.49, 1.5, 6, 4)
  on conflict (salon_id, name) do nothing
$$;

create or replace function public.on_salon_created_payment_methods()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_payment_methods(new.id);
  return null;
end $$;
create trigger trg_salon_payment_methods after insert on public.salons
  for each row execute function public.on_salon_created_payment_methods();

select public.seed_payment_methods(id) from public.salons;

alter table public.salons add column next_order_number int not null default 1;

-- ---------------------------------------------------------------------
-- Caixa: uma sessão aberta por vez, com suprimentos, sangrias e despesas
-- ---------------------------------------------------------------------
create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_amount numeric(10,2) not null default 0 check (opening_amount >= 0),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  expected_amount numeric(10,2),   -- dinheiro que deveria estar na gaveta (calculado ao fechar)
  counted_amount numeric(10,2),    -- o que foi contado
  difference numeric(10,2),        -- contado − esperado
  notes text,
  check ((closed_at is null) = (counted_amount is null))
);
create unique index cash_sessions_one_open on public.cash_sessions(salon_id) where closed_at is null;
create index cash_sessions_salon_idx on public.cash_sessions(salon_id, opened_at desc);

create type public.cash_movement_kind as enum ('suprimento', 'sangria', 'despesa', 'estorno');

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  cash_session_id uuid not null references public.cash_sessions(id),
  kind public.cash_movement_kind not null,
  amount numeric(10,2) not null check (amount > 0),
  description text not null check (length(trim(description)) > 0),
  order_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index cash_movements_session_idx on public.cash_movements(cash_session_id);

create or replace function public.check_cash_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.cash_sessions
                 where id = new.cash_session_id and salon_id = new.salon_id and closed_at is null) then
    raise exception 'CAIXA_FECHADO: o caixa desta movimentação não está aberto' using errcode = 'P0001';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  return new;
end $$;
create trigger trg_cash_movement_check before insert on public.cash_movements
  for each row execute function public.check_cash_movement();

-- ---------------------------------------------------------------------
-- Comandas
-- ---------------------------------------------------------------------
create type public.order_status as enum ('aberta', 'fechada', 'cancelada');
create type public.order_item_kind as enum ('servico', 'produto', 'pacote');

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  number int not null,
  client_id uuid references public.clients(id),         -- nulo = venda avulsa de balcão
  appointment_id uuid references public.appointments(id),
  status public.order_status not null default 'aberta',
  subtotal numeric(10,2) not null default 0,            -- soma dos itens (trigger)
  discount_amount numeric(10,2) not null default 0 check (discount_amount >= 0),
  discount_reason text,
  total numeric(10,2) generated always as (subtotal - discount_amount) stored,
  fee_total numeric(10,2) not null default 0,           -- taxas das maquininhas (no fechamento)
  notes text,
  cash_session_id uuid references public.cash_sessions(id),
  opened_by uuid references auth.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now(),
  unique (salon_id, number)
);
create index orders_salon_status_idx on public.orders(salon_id, status, opened_at desc);
create index orders_client_idx on public.orders(client_id);
create unique index orders_one_per_appointment on public.orders(appointment_id)
  where appointment_id is not null and status <> 'cancelada';
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind public.order_item_kind not null,
  service_id uuid references public.services(id),
  product_id uuid references public.products(id),
  package_id uuid references public.packages(id),
  professional_id uuid references public.professionals(id),     -- quem fez/vendeu (comissão)
  appointment_item_id uuid references public.appointment_items(id),
  client_package_balance_id uuid references public.client_package_balances(id),  -- sessão usada de um pacote
  description text not null,
  quantity numeric(10,3) not null default 1 check (quantity > 0),
  unit_price numeric(10,2) not null check (unit_price >= 0),
  discount_amount numeric(10,2) not null default 0 check (discount_amount >= 0),
  total numeric(10,2) generated always as (round(quantity * unit_price, 2) - discount_amount) stored,
  created_at timestamptz not null default now(),
  check (discount_amount <= round(quantity * unit_price, 2)),
  check (
    (kind = 'servico' and service_id is not null and professional_id is not null and product_id is null and package_id is null)
    or (kind = 'produto' and product_id is not null and service_id is null and package_id is null and client_package_balance_id is null)
    or (kind = 'pacote' and package_id is not null and service_id is null and product_id is null
        and client_package_balance_id is null and quantity = 1)
  )
);
create index order_items_order_idx on public.order_items(order_id);

create table public.order_payments (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  order_id uuid not null references public.orders(id),
  payment_method_id uuid not null references public.payment_methods(id),
  kind public.payment_kind not null,                    -- cópia da forma no momento
  amount numeric(10,2) not null check (amount > 0),
  installments smallint not null default 1 check (installments >= 1),
  fee_amount numeric(10,2) not null default 0,
  cash_session_id uuid not null references public.cash_sessions(id),
  refunded_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index order_payments_order_idx on public.order_payments(order_id);
create index order_payments_session_idx on public.order_payments(cash_session_id);

alter table public.stock_movements
  add constraint stock_movements_order_fk foreign key (order_id) references public.orders(id),
  add constraint stock_movements_order_item_fk foreign key (order_item_id) references public.order_items(id);
alter table public.client_packages
  add constraint client_packages_order_fk foreign key (order_id) references public.orders(id);
alter table public.cash_movements
  add constraint cash_movements_order_fk foreign key (order_id) references public.orders(id);

-- ---------------------------------------------------------------------
-- Comissões e pagamentos de comissão
-- ---------------------------------------------------------------------
create table public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  professional_id uuid not null references public.professionals(id),
  period_until date not null,
  total numeric(10,2) not null,
  method text,
  notes text,
  cash_movement_id uuid references public.cash_movements(id),
  paid_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz not null default now()
);
create index commission_payouts_prof_idx on public.commission_payouts(professional_id, paid_at desc);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  professional_id uuid not null references public.professionals(id),
  order_id uuid not null references public.orders(id),
  order_item_id uuid references public.order_items(id),
  order_number int not null,
  description text not null,
  competence_date date not null,          -- dia do fechamento, no fuso do salão
  base_amount numeric(10,2) not null,     -- valor sobre o qual o % incide
  pct numeric(5,2) not null,
  amount numeric(10,2) not null,          -- negativo = estorno de comissão já paga
  status text not null default 'pendente' check (status in ('pendente', 'paga', 'estornada')),
  reversal_of_id uuid references public.commissions(id),
  payout_id uuid references public.commission_payouts(id),
  created_at timestamptz not null default now()
);
create index commissions_prof_idx on public.commissions(professional_id, competence_date);
create index commissions_salon_idx on public.commissions(salon_id, competence_date);
create index commissions_order_idx on public.commissions(order_id);

-- ---------------------------------------------------------------------
-- Triggers das comandas
-- ---------------------------------------------------------------------

-- Número sequencial por salão
create or replace function public.assign_order_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.salons set next_order_number = next_order_number + 1
   where id = new.salon_id
  returning next_order_number - 1 into new.number;
  new.opened_by := coalesce(new.opened_by, auth.uid());
  return new;
end $$;
create trigger trg_orders_number before insert on public.orders
  for each row execute function public.assign_order_number();

create trigger trg_orders_client_same_salon before insert or update of client_id on public.orders
  for each row when (new.client_id is not null) execute function public.assert_client_same_salon();

create or replace function public.check_order_refs()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.appointment_id is not null and not exists (
       select 1 from public.appointments
       where id = new.appointment_id and salon_id = new.salon_id
         and client_id is not distinct from new.client_id) then
    raise exception 'O agendamento é de outro salão ou de outra cliente';
  end if;
  return new;
end $$;
create trigger trg_orders_refs before insert or update of appointment_id, client_id on public.orders
  for each row execute function public.check_order_refs();

-- Comanda fechada/cancelada não muda (só o cancelamento de uma fechada)
create or replace function public.guard_order_update()
returns trigger language plpgsql as $$
begin
  if old.status = 'aberta' then
    if new.status = 'fechada' and new.discount_amount > new.subtotal then
      raise exception 'O desconto é maior que o total da comanda';
    end if;
    return new;
  end if;
  if old.status = 'fechada' and new.status = 'cancelada'
     and new.subtotal = old.subtotal and new.discount_amount = old.discount_amount
     and new.client_id is not distinct from old.client_id then
    return new;
  end if;
  raise exception 'Comanda % não pode ser alterada (%)', old.number, old.status;
end $$;
create trigger trg_orders_guard before update on public.orders
  for each row execute function public.guard_order_update();

-- Itens: só em comanda aberta; preenche descrição e preço pelo catálogo
create or replace function public.prepare_order_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  b record;
begin
  select * into o from public.orders where id = coalesce(new.order_id, old.order_id);
  if o.status <> 'aberta' then
    raise exception 'A comanda % já está %', o.number, o.status;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.salon_id <> o.salon_id then
    raise exception 'Referência de outro salão';
  end if;

  if new.kind = 'servico' then
    select coalesce(new.description, s.name), coalesce(new.unit_price, ps.price, s.price)
      into new.description, new.unit_price
    from public.services s
    left join public.professional_services ps on ps.service_id = s.id and ps.professional_id = new.professional_id
    where s.id = new.service_id and s.salon_id = new.salon_id;
  elsif new.kind = 'produto' then
    select coalesce(new.description, p.name), coalesce(new.unit_price, p.sale_price)
      into new.description, new.unit_price
    from public.products p where p.id = new.product_id and p.salon_id = new.salon_id and p.for_sale;
    if new.description is null then raise exception 'Produto inválido ou não é de revenda'; end if;
  else
    if o.client_id is null then
      raise exception 'Escolha a cliente da comanda para vender um pacote';
    end if;
    select coalesce(new.description, 'Pacote · ' || p.name), coalesce(new.unit_price, p.price)
      into new.description, new.unit_price
    from public.packages p where p.id = new.package_id and p.salon_id = new.salon_id and p.active;
    if new.description is null then raise exception 'Pacote inválido ou inativo'; end if;
  end if;

  -- Sessão de pacote: serviço já pago na compra do pacote
  if new.client_package_balance_id is not null then
    select b2.*, cp.client_id, cp.status, cp.expires_at into b
    from public.client_package_balances b2
    join public.client_packages cp on cp.id = b2.client_package_id
    where b2.id = new.client_package_balance_id and b2.salon_id = new.salon_id;
    if not found or b.client_id is distinct from o.client_id or b.service_id <> new.service_id then
      raise exception 'Este pacote não é desta cliente ou não inclui este serviço';
    end if;
    if b.status <> 'ativo' or (b.expires_at is not null and b.expires_at <= now()) then
      raise exception 'Pacote vencido ou cancelado';
    end if;
    if b.sessions_used + new.quantity + (
         select coalesce(sum(i.quantity), 0) from public.order_items i
         join public.orders o2 on o2.id = i.order_id
         where i.client_package_balance_id = b.id and o2.status = 'aberta'
           and i.id <> new.id) > b.sessions_total then
      raise exception 'Não há sessões suficientes neste pacote';
    end if;
    new.unit_price := 0;
    new.discount_amount := 0;
    new.description := new.description || ' (pacote)';
  end if;
  return new;
end $$;
create trigger trg_order_items_prepare before insert or update or delete on public.order_items
  for each row execute function public.prepare_order_item();
create trigger trg_order_items_same_salon before insert or update on public.order_items
  for each row execute function public.assert_same_salon();

create or replace function public.sync_order_subtotal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders
     set subtotal = (select coalesce(sum(total), 0) from public.order_items where order_id = v_id)
   where id = v_id and status = 'aberta';
  return null;
end $$;
create trigger trg_order_items_subtotal after insert or update or delete on public.order_items
  for each row execute function public.sync_order_subtotal();

create trigger trg_audit_orders after insert or update or delete on public.orders
  for each row execute function public.write_audit_log();
create trigger trg_audit_order_items after insert or update or delete on public.order_items
  for each row execute function public.write_audit_log();
create trigger trg_audit_order_payments after insert or update or delete on public.order_payments
  for each row execute function public.write_audit_log();
create trigger trg_audit_cash_sessions after insert or update or delete on public.cash_sessions
  for each row execute function public.write_audit_log();
create trigger trg_audit_cash_movements after insert or update or delete on public.cash_movements
  for each row execute function public.write_audit_log();
create trigger trg_audit_commissions after insert or update or delete on public.commissions
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------
-- Caixa: abrir e fechar
-- ---------------------------------------------------------------------
create or replace function public.open_cash_session(p_salon_id uuid, p_opening_amount numeric default 0)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.is_salon_staff(p_salon_id) then
    raise exception 'Sem permissão para abrir o caixa' using errcode = '42501';
  end if;
  if exists (select 1 from public.cash_sessions where salon_id = p_salon_id and closed_at is null) then
    raise exception 'Já existe um caixa aberto';
  end if;
  insert into public.cash_sessions (salon_id, opened_by, opening_amount)
  values (p_salon_id, auth.uid(), coalesce(p_opening_amount, 0))
  returning id into v_id;
  return v_id;
end $$;

-- Resumo de um caixa: entradas por forma de pagamento e dinheiro esperado na gaveta
create or replace function public.cash_session_expected(p_session_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select s.opening_amount
    + coalesce((select sum(amount) from public.order_payments
                where cash_session_id = s.id and kind = 'dinheiro'), 0)
    + coalesce((select sum(case when kind = 'suprimento' then amount else -amount end)
                from public.cash_movements where cash_session_id = s.id), 0)
  from public.cash_sessions s where s.id = p_session_id
$$;

create or replace view public.cash_session_summary with (security_invoker = true) as
select
  s.id as cash_session_id,
  s.salon_id,
  s.opened_at,
  s.closed_at,
  s.opening_amount,
  coalesce(p.by_kind, '{}'::jsonb) as received_by_kind,
  coalesce(p.received, 0) as received_total,
  coalesce(p.fees, 0) as fees_total,
  coalesce(p.orders_count, 0) as orders_count,
  coalesce(m.suprimento, 0) as suprimentos,
  coalesce(m.sangria, 0) as sangrias,
  coalesce(m.despesa, 0) as despesas,
  coalesce(m.estorno, 0) as estornos,
  coalesce(s.expected_amount, public.cash_session_expected(s.id)) as expected_cash,
  s.counted_amount,
  s.difference
from public.cash_sessions s
left join lateral (
  select jsonb_object_agg(kind, total) as by_kind, sum(total) as received, sum(fees) as fees,
         sum(orders) as orders_count
  from (select kind, sum(amount) as total, sum(fee_amount) as fees, count(distinct order_id) as orders
        from public.order_payments where cash_session_id = s.id group by kind) x
) p on true
left join lateral (
  select sum(amount) filter (where kind = 'suprimento') as suprimento,
         sum(amount) filter (where kind = 'sangria') as sangria,
         sum(amount) filter (where kind = 'despesa') as despesa,
         sum(amount) filter (where kind = 'estorno') as estorno
  from public.cash_movements where cash_session_id = s.id
) m on true;

grant select on public.cash_session_summary to authenticated;

create or replace function public.close_cash_session(p_session_id uuid, p_counted_amount numeric, p_notes text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  s public.cash_sessions;
  v_expected numeric;
begin
  select * into s from public.cash_sessions where id = p_session_id for update;
  if not found or not public.is_salon_staff(s.salon_id) then
    raise exception 'Caixa não encontrado' using errcode = '42501';
  end if;
  if s.closed_at is not null then
    raise exception 'Este caixa já foi fechado';
  end if;
  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'Informe o valor contado na gaveta';
  end if;
  v_expected := public.cash_session_expected(s.id);
  update public.cash_sessions
     set closed_at = now(), closed_by = auth.uid(),
         expected_amount = v_expected, counted_amount = p_counted_amount,
         difference = p_counted_amount - v_expected,
         notes = coalesce(p_notes, notes)
   where id = s.id;
  return p_counted_amount - v_expected;
end $$;

-- ---------------------------------------------------------------------
-- Comanda a partir do agendamento (reaproveita a aberta, se houver).
-- Usa sozinha uma sessão de pacote da cliente quando há saldo.
-- ---------------------------------------------------------------------
create or replace function public.open_order_for_appointment(p_appointment_id uuid)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  a public.appointments;
  v_order uuid;
  it record;
  v_balance uuid;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'Agendamento não encontrado';
  end if;
  if a.status in ('cancelado', 'reagendado', 'nao_compareceu') then
    raise exception 'Agendamento % não gera comanda', a.status;
  end if;

  select id into v_order from public.orders
   where appointment_id = a.id and status <> 'cancelada';
  if found then
    return v_order;
  end if;

  insert into public.orders (salon_id, client_id, appointment_id)
  values (a.salon_id, a.client_id, a.id)
  returning id into v_order;

  for it in select * from public.appointment_items where appointment_id = a.id order by position loop
    select o.balance_id into v_balance
    from public.client_package_overview o
    where o.client_id = a.client_id and o.service_id = it.service_id and o.usable
      and o.sessions_left > (select count(*) from public.order_items i join public.orders x on x.id = i.order_id
                             where i.client_package_balance_id = o.balance_id and x.status = 'aberta')
    order by o.expires_at nulls last, o.purchased_at
    limit 1;

    insert into public.order_items (salon_id, order_id, kind, service_id, professional_id, appointment_item_id,
                                    unit_price, client_package_balance_id)
    values (a.salon_id, v_order, 'servico', it.service_id, it.professional_id, it.id, it.price, v_balance);
  end loop;

  return v_order;
end $$;

-- ---------------------------------------------------------------------
-- Fechamento
-- p_payments: [{payment_method_id, amount, installments?}]
-- Soma dos pagamentos = total da comanda (o troco fica na tela).
-- ---------------------------------------------------------------------
-- Núcleo do fechamento, com data e caixa explícitos (a demonstração usa para
-- gerar o histórico). Não é exposto: quem chama é close_order().
create or replace function public.close_order_internal(
  p_order_id uuid, p_payments jsonb, p_at timestamptz, p_session uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  sl public.salons;
  v_session uuid := p_session;
  v_pay jsonb;
  m public.payment_methods;
  v_amount numeric(10,2);
  v_inst int;
  v_paid numeric(10,2) := 0;
  v_fees numeric(10,2) := 0;
  it record;
  v_cp uuid;
  v_pkg_sum numeric;
  v_base numeric;
  v_pct numeric;
  v_supply_cost numeric;
  v_day date;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Comanda não encontrada';
  end if;
  if o.status <> 'aberta' then
    raise exception 'A comanda % já está %', o.number, o.status;
  end if;
  if not exists (select 1 from public.order_items where order_id = o.id) then
    raise exception 'Lance pelo menos um item na comanda';
  end if;
  if o.discount_amount > o.subtotal then
    raise exception 'O desconto é maior que o total da comanda';
  end if;

  select * into sl from public.salons where id = o.salon_id;
  v_day := (p_at at time zone sl.timezone)::date;

  -- Pagamentos
  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    select * into m from public.payment_methods
     where id = (v_pay ->> 'payment_method_id')::uuid and salon_id = o.salon_id and active;
    if not found then
      raise exception 'Forma de pagamento inválida';
    end if;
    v_amount := round((v_pay ->> 'amount')::numeric, 2);
    v_inst := coalesce((v_pay ->> 'installments')::int, 1);
    if v_amount is null or v_amount <= 0 then
      raise exception 'Valor de pagamento inválido';
    end if;
    if v_inst < 1 or v_inst > m.max_installments then
      raise exception '% aceita até % parcela(s)', m.name, m.max_installments;
    end if;
    insert into public.order_payments (salon_id, order_id, payment_method_id, kind, amount, installments, fee_amount, cash_session_id, created_by, created_at)
    values (o.salon_id, o.id, m.id, m.kind, v_amount, v_inst,
            round(v_amount * (m.fee_pct + (v_inst - 1) * m.installment_fee_pct) / 100, 2),
            v_session, auth.uid(), p_at);
    v_paid := v_paid + v_amount;
  end loop;
  if v_paid <> o.total then
    raise exception 'PAGAMENTO_DIFERENTE: os pagamentos somam % e a comanda é %', v_paid, o.total using errcode = 'P0001';
  end if;
  select coalesce(sum(fee_amount), 0) into v_fees from public.order_payments where order_id = o.id;

  for it in
    select i.*, s.name as service_name
    from public.order_items i left join public.services s on s.id = i.service_id
    where i.order_id = o.id order by i.created_at
  loop
    -- Pacote vendido → saldo de sessões, com o preço rateado por sessão
    if it.kind = 'pacote' then
      insert into public.client_packages (salon_id, client_id, package_id, name, price, order_id, purchased_at, expires_at)
      select o.salon_id, o.client_id, p.id, p.name, it.total, o.id, p_at,
             case when p.validity_days is not null then p_at + make_interval(days => p.validity_days) end
      from public.packages p where p.id = it.package_id
      returning id into v_cp;

      select sum(pi.sessions * s.price) into v_pkg_sum
      from public.package_items pi join public.services s on s.id = pi.service_id
      where pi.package_id = it.package_id;

      insert into public.client_package_balances (salon_id, client_package_id, service_id, sessions_total, unit_value)
      select o.salon_id, v_cp, pi.service_id, pi.sessions,
             case when coalesce(v_pkg_sum, 0) > 0 then round(it.total * s.price / v_pkg_sum, 2)
                  else round(it.total / sum(pi.sessions) over (), 2) end
      from public.package_items pi join public.services s on s.id = pi.service_id
      where pi.package_id = it.package_id;
    end if;

    -- Sessão de pacote usada
    if it.client_package_balance_id is not null then
      update public.client_package_balances
         set sessions_used = sessions_used + it.quantity::int
       where id = it.client_package_balance_id
         and sessions_used + it.quantity::int <= sessions_total;
      if not found then
        raise exception 'Não há sessões suficientes no pacote para "%"', it.description;
      end if;
    end if;

    -- Estoque: venda do produto e consumo do serviço
    if it.kind = 'produto' then
      insert into public.stock_movements (salon_id, product_id, kind, quantity, order_id, order_item_id, created_by, created_at)
      select o.salon_id, p.id, 'venda', -(it.quantity * p.package_size), o.id, it.id, auth.uid(), p_at
      from public.products p where p.id = it.product_id;
    elsif it.kind = 'servico' then
      insert into public.stock_movements (salon_id, product_id, kind, quantity, order_id, order_item_id, created_by, created_at)
      select o.salon_id, ss.product_id, 'uso', -(ss.quantity * it.quantity), o.id, it.id, auth.uid(), p_at
      from public.service_supplies ss join public.products p on p.id = ss.product_id
      where ss.service_id = it.service_id and p.active;
    end if;

    -- Comissão
    continue when it.professional_id is null or it.kind = 'pacote';
    if it.client_package_balance_id is not null then
      select unit_value * it.quantity into v_base from public.client_package_balances where id = it.client_package_balance_id;
    else
      v_base := it.total - case when o.subtotal > 0 then o.discount_amount * it.total / o.subtotal else 0 end;
    end if;
    if sl.commission_base = 'liquido' then
      if sl.commission_deduct_card_fee and o.total > 0 and it.client_package_balance_id is null then
        v_base := v_base - v_fees * v_base / o.total;
      end if;
      if sl.commission_deduct_product_cost and it.kind = 'servico' then
        select coalesce(sum(ss.quantity * it.quantity * p.cost_price / p.package_size), 0) into v_supply_cost
        from public.service_supplies ss join public.products p on p.id = ss.product_id
        where ss.service_id = it.service_id;
        v_base := v_base - v_supply_cost;
      end if;
    end if;
    v_base := greatest(round(v_base, 2), 0);

    if it.kind = 'servico' then
      -- 1º o % do profissional para o serviço, 2º o padrão do profissional, 3º o padrão do serviço
      select coalesce(ps.commission_pct, nullif(pr.default_commission_pct, 0), s.default_commission_pct)
        into v_pct
      from public.services s
      join public.professionals pr on pr.id = it.professional_id
      left join public.professional_services ps on ps.service_id = s.id and ps.professional_id = pr.id
      where s.id = it.service_id;
    else
      select commission_pct into v_pct from public.products where id = it.product_id;
    end if;

    if coalesce(v_pct, 0) > 0 then
      insert into public.commissions (salon_id, professional_id, order_id, order_item_id, order_number, description,
                                      competence_date, base_amount, pct, amount, created_at)
      values (o.salon_id, it.professional_id, o.id, it.id, o.number, it.description,
              v_day, v_base, v_pct, round(v_base * v_pct / 100, 2), p_at);
    end if;
  end loop;

  update public.orders
     set status = 'fechada', closed_at = p_at, closed_by = auth.uid(),
         cash_session_id = v_session, fee_total = v_fees
   where id = o.id;

  if o.appointment_id is not null then
    update public.appointments set status = 'concluido'
     where id = o.appointment_id and status in ('agendado', 'confirmado', 'em_atendimento');
  end if;
end $$;

create or replace function public.close_order(p_order_id uuid, p_payments jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid;
  v_session uuid;
begin
  select salon_id into v_salon from public.orders where id = p_order_id;
  if v_salon is null or not public.is_salon_staff(v_salon) then
    raise exception 'Comanda não encontrada' using errcode = '42501';
  end if;
  select id into v_session from public.cash_sessions where salon_id = v_salon and closed_at is null;
  if v_session is null then
    raise exception 'CAIXA_FECHADO: abra o caixa para fechar comandas' using errcode = 'P0001';
  end if;
  perform public.close_order_internal(p_order_id, p_payments, now(), v_session);
end $$;

-- ---------------------------------------------------------------------
-- Cancelamento
-- Aberta: recepção/admin. Fechada: só admin, com o caixa aberto; estorna
-- pagamentos (dinheiro sai da gaveta), estoque, pacotes e comissões
-- (comissão já paga vira um lançamento negativo para o próximo acerto).
-- ---------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders;
  v_session uuid;
  v_cash numeric;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found or not public.is_salon_staff(o.salon_id) then
    raise exception 'Comanda não encontrada' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Informe o motivo do cancelamento';
  end if;
  if o.status = 'cancelada' then
    raise exception 'A comanda já está cancelada';
  end if;

  if o.status = 'fechada' then
    if not public.is_salon_admin(o.salon_id) then
      raise exception 'Só o administrador cancela uma comanda fechada' using errcode = '42501';
    end if;
    if exists (
      select 1 from public.client_packages cp
      join public.client_package_balances b on b.client_package_id = cp.id
      where cp.order_id = o.id and b.sessions_used > 0) then
      raise exception 'Um pacote desta comanda já foi usado; cancele as sessões antes';
    end if;

    select coalesce(sum(amount), 0) into v_cash from public.order_payments
     where order_id = o.id and kind = 'dinheiro' and refunded_at is null;
    if v_cash > 0 then
      select id into v_session from public.cash_sessions where salon_id = o.salon_id and closed_at is null;
      if v_session is null then
        raise exception 'CAIXA_FECHADO: abra o caixa para devolver o dinheiro' using errcode = 'P0001';
      end if;
      insert into public.cash_movements (salon_id, cash_session_id, kind, amount, description, order_id, created_by)
      values (o.salon_id, v_session, 'estorno', v_cash, 'Estorno da comanda #' || o.number, o.id, auth.uid());
    end if;
    update public.order_payments set refunded_at = now() where order_id = o.id and refunded_at is null;

    insert into public.stock_movements (salon_id, product_id, kind, quantity, unit_cost, order_id, notes, created_by)
    select salon_id, product_id, 'estorno', -quantity, unit_cost, order_id, 'Estorno da comanda #' || o.number, auth.uid()
    from public.stock_movements where order_id = o.id and kind in ('venda', 'uso');

    update public.client_package_balances b
       set sessions_used = b.sessions_used - x.qty
      from (select client_package_balance_id as id, sum(quantity)::int as qty
            from public.order_items where order_id = o.id and client_package_balance_id is not null
            group by client_package_balance_id) x
     where b.id = x.id;
    update public.client_packages set status = 'cancelado' where order_id = o.id;

    update public.commissions set status = 'estornada'
     where order_id = o.id and status = 'pendente' and reversal_of_id is null;
    insert into public.commissions (salon_id, professional_id, order_id, order_item_id, order_number, description,
                                    competence_date, base_amount, pct, amount, reversal_of_id)
    select c.salon_id, c.professional_id, c.order_id, c.order_item_id, c.order_number, 'Estorno · ' || c.description,
           (now() at time zone s.timezone)::date, -c.base_amount, c.pct, -c.amount, c.id
    from public.commissions c join public.salons s on s.id = c.salon_id
    where c.order_id = o.id and c.status = 'paga' and c.reversal_of_id is null;
  end if;

  update public.orders
     set status = 'cancelada', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
   where id = o.id;
end $$;

-- ---------------------------------------------------------------------
-- Acerto de comissões: paga tudo que está pendente até a data
-- ---------------------------------------------------------------------
create or replace function public.pay_commissions(
  p_professional_id uuid,
  p_until date,
  p_method text default null,
  p_notes text default null,
  p_from_cash boolean default false
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  pr public.professionals;
  v_total numeric(10,2);
  v_payout uuid;
  v_session uuid;
  v_mov uuid;
begin
  select * into pr from public.professionals where id = p_professional_id;
  if not found or not public.is_salon_admin(pr.salon_id) then
    raise exception 'Só o administrador registra pagamento de comissão' using errcode = '42501';
  end if;

  select coalesce(sum(amount), 0) into v_total from public.commissions
   where professional_id = pr.id and status = 'pendente' and competence_date <= p_until;
  if v_total <= 0 then
    raise exception 'Não há comissão a pagar até %', to_char(p_until, 'DD/MM/YYYY');
  end if;

  if p_from_cash then
    select id into v_session from public.cash_sessions where salon_id = pr.salon_id and closed_at is null;
    if v_session is null then
      raise exception 'CAIXA_FECHADO: abra o caixa para pagar em dinheiro' using errcode = 'P0001';
    end if;
    insert into public.cash_movements (salon_id, cash_session_id, kind, amount, description, created_by)
    values (pr.salon_id, v_session, 'despesa', v_total, 'Comissão · ' || pr.name, auth.uid())
    returning id into v_mov;
  end if;

  insert into public.commission_payouts (salon_id, professional_id, period_until, total, method, notes, cash_movement_id, paid_by)
  values (pr.salon_id, pr.id, p_until, v_total, coalesce(p_method, case when p_from_cash then 'Dinheiro do caixa' end), p_notes, v_mov, auth.uid())
  returning id into v_payout;

  update public.commissions set status = 'paga', payout_id = v_payout
   where professional_id = pr.id and status = 'pendente' and competence_date <= p_until;
  return v_payout;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- Comandas e caixa: recepção e admin. Profissional vê só as próprias
-- comissões e acertos. Pagamentos, comissões e pacotes vendidos só
-- nascem pelas funções acima.
-- ---------------------------------------------------------------------
alter table public.payment_methods enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_payments enable row level security;
alter table public.commissions enable row level security;
alter table public.commission_payouts enable row level security;

create policy payment_methods_select on public.payment_methods for select to authenticated
  using (public.is_salon_member(salon_id));
create policy payment_methods_insert on public.payment_methods for insert to authenticated
  with check (public.is_salon_admin(salon_id));
create policy payment_methods_update on public.payment_methods for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy cash_sessions_select on public.cash_sessions for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy cash_movements_select on public.cash_movements for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy cash_movements_insert on public.cash_movements for insert to authenticated
  with check (public.is_salon_staff(salon_id) and kind <> 'estorno' and order_id is null);

create policy orders_select on public.orders for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy orders_insert on public.orders for insert to authenticated
  with check (public.is_salon_staff(salon_id) and status = 'aberta');
create policy orders_update on public.orders for update to authenticated
  using (public.is_salon_staff(salon_id)) with check (public.is_salon_staff(salon_id));

revoke insert, update on public.orders from authenticated;
grant insert (salon_id, client_id, appointment_id, discount_amount, discount_reason, notes) on public.orders to authenticated;
grant update (client_id, discount_amount, discount_reason, notes) on public.orders to authenticated;

create policy order_items_select on public.order_items for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy order_items_insert on public.order_items for insert to authenticated
  with check (public.is_salon_staff(salon_id));
create policy order_items_update on public.order_items for update to authenticated
  using (public.is_salon_staff(salon_id)) with check (public.is_salon_staff(salon_id));
create policy order_items_delete on public.order_items for delete to authenticated
  using (public.is_salon_staff(salon_id));

create policy order_payments_select on public.order_payments for select to authenticated
  using (public.is_salon_staff(salon_id));

create policy commissions_select on public.commissions for select to authenticated
  using (public.is_salon_admin(salon_id) or professional_id = public.my_professional_id(salon_id));
create policy commission_payouts_select on public.commission_payouts for select to authenticated
  using (public.is_salon_admin(salon_id) or professional_id = public.my_professional_id(salon_id));

revoke insert, update, delete on public.cash_sessions, public.order_payments, public.commissions,
  public.commission_payouts, public.client_packages, public.client_package_balances from authenticated;
revoke update, delete on public.cash_movements, public.stock_movements from authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'open_cash_session(uuid, numeric)',
    'close_cash_session(uuid, numeric, text)',
    'open_order_for_appointment(uuid)',
    'close_order(uuid, jsonb)',
    'cancel_order(uuid, text)',
    'pay_commissions(uuid, date, text, text, boolean)',
    'cash_session_expected(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke execute on function public.seed_payment_methods(uuid) from public, anon, authenticated';
  execute 'revoke execute on function public.close_order_internal(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated';
end $$;
