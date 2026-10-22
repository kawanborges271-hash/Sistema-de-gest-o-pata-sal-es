-- =====================================================================
-- Salon OS · 013 · Fidelidade
-- Pontos por real pago (resgate em serviços) e indicação: quando a
-- cliente indicada paga a primeira comanda, quem indicou ganha crédito em
-- R$, usado como forma de pagamento "Crédito de indicação".
-- Tudo passa por um extrato (loyalty_ledger); saldo = soma do extrato.
-- =====================================================================

alter table public.salons
  add column loyalty_enabled boolean not null default false,
  add column loyalty_points_per_real numeric(6,2) not null default 1 check (loyalty_points_per_real between 0.01 and 100),
  add column referral_enabled boolean not null default false,
  add column referral_credit numeric(10,2) not null default 20 check (referral_credit between 0 and 10000);

alter table public.payment_methods add column loyalty_credit boolean not null default false;
create unique index payment_methods_loyalty_uniq on public.payment_methods(salon_id) where loyalty_credit;

-- Prêmios: um serviço por X pontos
create table public.loyalty_rewards (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  service_id uuid not null references public.services(id),
  points_cost int not null check (points_cost between 1 and 1000000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, service_id)
);
create trigger trg_loyalty_rewards_updated before update on public.loyalty_rewards
  for each row execute function public.set_updated_at();
create trigger trg_loyalty_rewards_same_salon before insert or update on public.loyalty_rewards
  for each row execute function public.assert_same_salon();
create trigger trg_audit_loyalty_rewards after insert or update or delete on public.loyalty_rewards
  for each row execute function public.write_audit_log();

-- Extrato: pontos (inteiros) ou crédito (R$)
create table public.loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  kind text not null check (kind in ('pontos', 'credito')),
  amount numeric(10,2) not null check (amount <> 0),
  reason text not null check (reason in ('compra', 'resgate', 'indicacao', 'uso_credito', 'estorno', 'ajuste')),
  order_id uuid references public.orders(id),
  order_item_id uuid references public.order_items(id) on delete set null,
  order_payment_id uuid references public.order_payments(id),
  reward_id uuid references public.loyalty_rewards(id),
  referred_client_id uuid references public.clients(id),
  reversal_of_id uuid references public.loyalty_ledger(id),
  note text check (length(note) <= 300),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind = 'credito' or amount = trunc(amount))
);
create index loyalty_ledger_client_idx on public.loyalty_ledger(client_id, created_at desc);
create index loyalty_ledger_order_idx on public.loyalty_ledger(order_id) where order_id is not null;
create unique index loyalty_ledger_referral_uniq on public.loyalty_ledger(referred_client_id)
  where reason = 'indicacao' and reversal_of_id is null;
create unique index loyalty_ledger_reversal_uniq on public.loyalty_ledger(reversal_of_id) where reversal_of_id is not null;

alter table public.order_items add column loyalty_reward_id uuid references public.loyalty_rewards(id);

create or replace view public.client_loyalty_balance with (security_invoker = true) as
select c.salon_id, c.id as client_id, c.name,
       coalesce(sum(l.amount) filter (where l.kind = 'pontos'), 0)::int as points,
       coalesce(sum(l.amount) filter (where l.kind = 'credito'), 0)::numeric(10,2) as credit,
       max(l.created_at) as last_movement_at
from public.clients c
left join public.loyalty_ledger l on l.client_id = c.id
group by c.salon_id, c.id, c.name;
grant select on public.client_loyalty_balance to authenticated;

create or replace function public.loyalty_balance(p_client_id uuid, p_kind text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0) from public.loyalty_ledger where client_id = p_client_id and kind = p_kind
$$;
revoke execute on function public.loyalty_balance(uuid, text) from public, anon, authenticated;

-- Estorna as linhas do extrato ainda não estornadas que batem com o filtro
create or replace function public.loyalty_reverse(p_order_id uuid, p_item_id uuid, p_reasons text[], p_note text)
returns void language sql security definer set search_path = public as $$
  insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, order_item_id, reward_id,
                                     referred_client_id, reversal_of_id, note)
  select l.salon_id, l.client_id, l.kind, -l.amount, 'estorno', l.order_id,
         l.order_item_id, l.reward_id, l.referred_client_id, l.id, p_note
  from public.loyalty_ledger l
  where l.reason = any(p_reasons) and l.reversal_of_id is null
    and (p_order_id is null or l.order_id = p_order_id)
    and (p_item_id is null or l.order_item_id = p_item_id)
    and not exists (select 1 from public.loyalty_ledger r where r.reversal_of_id = l.id)
$$;
revoke execute on function public.loyalty_reverse(uuid, uuid, text[], text) from public, anon, authenticated;

-- Forma de pagamento "Crédito de indicação" aparece quando a indicação é ligada
create or replace function public.on_salon_referral()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.referral_enabled then
    insert into public.payment_methods (salon_id, name, kind, sort_order, loyalty_credit)
    values (new.id, 'Crédito de indicação', 'voucher', 90, true)
    on conflict (salon_id, name) do update set active = true, loyalty_credit = true;
  end if;
  return null;
end $$;
create trigger trg_salon_referral after insert or update of referral_enabled on public.salons
  for each row execute function public.on_salon_referral();

-- Pagar com crédito: debita do extrato; sem saldo, a comanda não fecha.
-- Estorno do pagamento (cancelamento da comanda) devolve o crédito.
create or replace function public.on_loyalty_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_client uuid;
begin
  if not exists (select 1 from public.payment_methods where id = new.payment_method_id and loyalty_credit) then
    return null;
  end if;
  select client_id into v_client from public.orders where id = new.order_id;
  if tg_op = 'INSERT' then
    if v_client is null then
      raise exception 'Escolha a cliente da comanda para usar o crédito de indicação';
    end if;
    if public.loyalty_balance(v_client, 'credito') < new.amount then
      raise exception 'A cliente tem % de crédito de indicação', to_char(public.loyalty_balance(v_client, 'credito'), 'FM"R$ "999G990D00');
    end if;
    insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, order_payment_id)
    values (new.salon_id, v_client, 'credito', -new.amount, 'uso_credito', new.order_id, new.id);
  elsif old.refunded_at is null and new.refunded_at is not null then
    insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, order_payment_id, reversal_of_id, note)
    select l.salon_id, l.client_id, 'credito', -l.amount, 'estorno', l.order_id, l.order_payment_id, l.id, 'Comanda cancelada'
    from public.loyalty_ledger l
    where l.order_payment_id = new.id and l.reason = 'uso_credito'
      and not exists (select 1 from public.loyalty_ledger r where r.reversal_of_id = l.id);
  end if;
  return null;
end $$;
create trigger trg_order_payments_loyalty after insert or update of refunded_at on public.order_payments
  for each row execute function public.on_loyalty_payment();

-- Comanda paga: pontos sobre o que foi pago (menos crédito de indicação) e,
-- na primeira comanda da cliente indicada, o crédito para quem indicou.
-- Comanda cancelada: estorna pontos, indicação e resgates.
create or replace function public.on_order_loyalty()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  sl public.salons;
  c public.clients;
  v_base numeric;
  v_points int;
begin
  if new.status = old.status then
    return null;
  end if;
  if new.status = 'cancelada' then
    perform public.loyalty_reverse(new.id, null, array['compra', 'indicacao', 'resgate'], 'Comanda #' || new.number || ' cancelada');
    return null;
  end if;
  if new.status <> 'fechada' or new.client_id is null then
    return null;
  end if;
  select * into sl from public.salons where id = new.salon_id;
  select * into c from public.clients where id = new.client_id;

  if sl.loyalty_enabled then
    select new.total - coalesce(sum(p.amount), 0) into v_base
    from public.order_payments p join public.payment_methods m on m.id = p.payment_method_id
    where p.order_id = new.id and m.loyalty_credit;
    v_points := floor(greatest(v_base, 0) * sl.loyalty_points_per_real);
    if v_points > 0 then
      insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, note)
      values (new.salon_id, new.client_id, 'pontos', v_points, 'compra', new.id, 'Comanda #' || new.number);
    end if;
  end if;

  if sl.referral_enabled and c.referred_by_client_id is not null and sl.referral_credit > 0
     and not exists (select 1 from public.orders o
                     where o.client_id = c.id and o.status = 'fechada' and o.id <> new.id)
     and not exists (select 1 from public.loyalty_ledger l
                     where l.referred_client_id = c.id and l.reason = 'indicacao' and l.reversal_of_id is null
                       and not exists (select 1 from public.loyalty_ledger r where r.reversal_of_id = l.id)) then
    insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, referred_client_id, note)
    values (new.salon_id, c.referred_by_client_id, 'credito', sl.referral_credit, 'indicacao', new.id, c.id,
            'Indicou ' || c.name);
  end if;
  return null;
end $$;
create trigger trg_orders_loyalty after update of status on public.orders
  for each row execute function public.on_order_loyalty();

-- Resgate: o serviço da comanda sai de graça e os pontos saem do extrato
create or replace function public.redeem_loyalty_reward(p_order_item_id uuid, p_reward_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  it public.order_items;
  o public.orders;
  rw public.loyalty_rewards;
  v_balance numeric;
begin
  select * into it from public.order_items where id = p_order_item_id for update;
  if not found or not public.is_salon_staff(it.salon_id) then
    raise exception 'Item não encontrado' using errcode = '42501';
  end if;
  select * into o from public.orders where id = it.order_id;
  select * into rw from public.loyalty_rewards where id = p_reward_id and salon_id = it.salon_id and active;
  if not found then
    raise exception 'Prêmio não encontrado';
  end if;
  if not (select loyalty_enabled from public.salons where id = it.salon_id) then
    raise exception 'O programa de pontos está desligado';
  end if;
  if o.status <> 'aberta' then
    raise exception 'A comanda já está %', o.status;
  end if;
  if o.client_id is null then
    raise exception 'Escolha a cliente da comanda para resgatar pontos';
  end if;
  if it.kind <> 'servico' or it.service_id <> rw.service_id then
    raise exception 'Este prêmio é para outro serviço';
  end if;
  if it.loyalty_reward_id is not null or it.client_package_balance_id is not null then
    raise exception 'Este item já está pago com pontos ou pacote';
  end if;
  v_balance := public.loyalty_balance(o.client_id, 'pontos');
  if v_balance < rw.points_cost then
    raise exception 'A cliente tem % pontos e o prêmio pede %', v_balance::int, rw.points_cost;
  end if;

  perform set_config('app.loyalty_redeem', 'on', true);
  update public.order_items
     set loyalty_reward_id = rw.id, discount_amount = least(round(quantity * unit_price, 2), unit_price)
   where id = it.id;
  perform set_config('app.loyalty_redeem', '', true);
  insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, order_id, order_item_id, reward_id, note)
  values (it.salon_id, o.client_id, 'pontos', -rw.points_cost, 'resgate', o.id, it.id, rw.id,
          'Resgate · ' || it.description);
end $$;

create or replace function public.undo_loyalty_redemption(p_order_item_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  it public.order_items;
begin
  select * into it from public.order_items where id = p_order_item_id for update;
  if not found or not public.is_salon_staff(it.salon_id) then
    raise exception 'Item não encontrado' using errcode = '42501';
  end if;
  if it.loyalty_reward_id is null then
    return;
  end if;
  perform public.loyalty_reverse(null, it.id, array['resgate'], 'Resgate desfeito');
  perform set_config('app.loyalty_undo', 'on', true);
  update public.order_items set loyalty_reward_id = null, discount_amount = 0 where id = it.id;
  perform set_config('app.loyalty_undo', '', true);
end $$;

-- Item com resgate: não muda preço, quantidade nem desconto (desfaça o resgate antes).
-- Item apagado: os pontos voltam.
create or replace function public.guard_loyalty_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.loyalty_reward_id is not null then
      raise exception 'Use o resgate de pontos da comanda';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.loyalty_reward_id is not null then
      perform public.loyalty_reverse(null, old.id, array['resgate'], 'Item removido da comanda');
    end if;
    return old;
  end if;
  if old.loyalty_reward_id is not null and coalesce(current_setting('app.loyalty_undo', true), '') <> 'on'
     and (new.discount_amount <> old.discount_amount
          or new.unit_price <> old.unit_price or new.quantity <> old.quantity or new.service_id <> old.service_id) then
    raise exception 'Este serviço foi pago com pontos. Desfaça o resgate antes de mudar o item.';
  end if;
  if new.loyalty_reward_id is distinct from old.loyalty_reward_id
     and coalesce(current_setting('app.loyalty_undo', true), '') <> 'on'
     and coalesce(current_setting('app.loyalty_redeem', true), '') <> 'on' then
    raise exception 'Use o resgate de pontos da comanda';
  end if;
  return new;
end $$;
create trigger trg_order_items_loyalty before insert or update or delete on public.order_items
  for each row execute function public.guard_loyalty_item();

-- Comanda com resgate não troca de cliente
create or replace function public.guard_order_client_loyalty()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is distinct from old.client_id and exists (
       select 1 from public.order_items where order_id = new.id and loyalty_reward_id is not null) then
    raise exception 'Esta comanda tem resgate de pontos. Desfaça o resgate antes de trocar a cliente.';
  end if;
  return new;
end $$;
create trigger trg_orders_client_loyalty before update of client_id on public.orders
  for each row execute function public.guard_order_client_loyalty();

-- Ajuste manual (admin), com motivo
create or replace function public.adjust_loyalty(p_client_id uuid, p_kind text, p_amount numeric, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.clients;
begin
  select * into c from public.clients where id = p_client_id;
  if not found or not public.is_salon_admin(c.salon_id) then
    raise exception 'Só o administrador ajusta pontos e crédito' using errcode = '42501';
  end if;
  if p_kind not in ('pontos', 'credito') or coalesce(p_amount, 0) = 0 then
    raise exception 'Ajuste inválido';
  end if;
  if p_kind = 'pontos' and p_amount <> trunc(p_amount) then
    raise exception 'Pontos são números inteiros';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Escreva o motivo do ajuste';
  end if;
  insert into public.loyalty_ledger (salon_id, client_id, kind, amount, reason, note)
  values (c.salon_id, c.id, p_kind, round(p_amount, 2), 'ajuste', trim(p_note));
end $$;

-- Resumo do programa
create or replace function public.loyalty_summary(p_salon_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_salon_staff(p_salon_id) then jsonb_build_object(
    'clients_with_points', (select count(*) from public.client_loyalty_balance where salon_id = p_salon_id and points > 0),
    'points_outstanding', (select coalesce(sum(points), 0) from public.client_loyalty_balance where salon_id = p_salon_id and points > 0),
    'credit_outstanding', (select coalesce(sum(credit), 0) from public.client_loyalty_balance where salon_id = p_salon_id and credit > 0),
    'points_30d', (select coalesce(sum(amount), 0) from public.loyalty_ledger
                   where salon_id = p_salon_id and kind = 'pontos' and reason = 'compra' and created_at >= now() - interval '30 days'),
    'redeemed_30d', (select count(*) from public.loyalty_ledger l
                     where l.salon_id = p_salon_id and l.reason = 'resgate' and l.created_at >= now() - interval '30 days'
                       and not exists (select 1 from public.loyalty_ledger r where r.reversal_of_id = l.id)),
    'referrals_total', (select count(*) from public.clients where salon_id = p_salon_id and referred_by_client_id is not null),
    'referrals_converted', (select count(*) from public.loyalty_ledger l
                            where l.salon_id = p_salon_id and l.reason = 'indicacao'
                              and not exists (select 1 from public.loyalty_ledger r where r.reversal_of_id = l.id))
  ) end
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.loyalty_rewards enable row level security;
alter table public.loyalty_ledger enable row level security;

create policy loyalty_rewards_select on public.loyalty_rewards for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy loyalty_rewards_write on public.loyalty_rewards for all to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));
grant select, insert, update on public.loyalty_rewards to authenticated;

create policy loyalty_ledger_select on public.loyalty_ledger for select to authenticated
  using (public.is_salon_staff(salon_id));
revoke insert, update, delete on public.loyalty_ledger from authenticated, anon;
grant select on public.loyalty_ledger to authenticated;

revoke execute on function public.redeem_loyalty_reward(uuid, uuid) from public, anon;
revoke execute on function public.undo_loyalty_redemption(uuid) from public, anon;
revoke execute on function public.adjust_loyalty(uuid, text, numeric, text) from public, anon;
revoke execute on function public.loyalty_summary(uuid) from public, anon;
grant execute on function public.redeem_loyalty_reward(uuid, uuid) to authenticated;
grant execute on function public.undo_loyalty_redemption(uuid) to authenticated;
grant execute on function public.adjust_loyalty(uuid, text, numeric, text) to authenticated;
grant execute on function public.loyalty_summary(uuid) to authenticated;
