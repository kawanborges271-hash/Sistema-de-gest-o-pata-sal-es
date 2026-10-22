-- =====================================================================
-- Salon OS · 006 · Produtos, estoque e pacotes
-- O saldo do produto só muda por movimentação (entrada, venda, uso, ajuste,
-- perda, estorno). Venda e uso nascem do fechamento da comanda (007).
-- =====================================================================

create or replace function public.row_in_salon(p_table text, p_id uuid, p_salon_id uuid)
returns boolean language plpgsql stable as $$
declare
  v_ok boolean;
begin
  execute format('select exists (select 1 from public.%I where id = $1 and salon_id = $2)', p_table)
    into v_ok using p_id, p_salon_id;
  return v_ok;
end $$;

-- assert_same_salon (002) passa a checar também produto e pacote
create or replace function public.assert_same_salon()
returns trigger language plpgsql as $$
declare
  v_row jsonb := to_jsonb(new);
  v_key text;
  v_table text;
begin
  foreach v_key in array array['category_id', 'professional_id', 'service_id', 'product_id', 'package_id'] loop
    continue when not (v_row ? v_key) or v_row ->> v_key is null;
    v_table := case v_key
      when 'category_id' then 'service_categories'
      when 'professional_id' then 'professionals'
      when 'service_id' then 'services'
      when 'product_id' then 'products'
      when 'package_id' then 'packages'
    end;
    if not public.row_in_salon(v_table, (v_row ->> v_key)::uuid, new.salon_id) then
      raise exception 'Referência de outro salão';
    end if;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Produtos
-- Estoque na unidade base (un, ml, g). Uma embalagem tem package_size
-- unidades; custo e preço de venda são por embalagem.
-- ---------------------------------------------------------------------
create table public.products (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  brand text,
  barcode text,
  unit text not null default 'un' check (unit in ('un', 'ml', 'g')),
  package_size numeric(10,3) not null default 1 check (package_size > 0),
  for_sale boolean not null default true,         -- revenda (balcão)
  for_use boolean not null default false,         -- uso interno nos serviços
  cost_price numeric(10,2) not null default 0 check (cost_price >= 0),
  sale_price numeric(10,2) not null default 0 check (sale_price >= 0),
  commission_pct numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  min_stock numeric(12,3) not null default 0 check (min_stock >= 0),
  current_stock numeric(12,3) not null default 0,  -- mantido pelas movimentações
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (for_sale or for_use)
);
create index products_salon_idx on public.products(salon_id) where active;
create unique index products_barcode_idx on public.products(salon_id, barcode) where barcode is not null;
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

create type public.stock_movement_kind as enum ('entrada', 'venda', 'uso', 'ajuste', 'perda', 'estorno');

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  product_id uuid not null references public.products(id),
  kind public.stock_movement_kind not null,
  quantity numeric(12,3) not null check (quantity <> 0),   -- + entra, − sai (unidade base)
  unit_cost numeric(12,4),                                  -- custo por unidade base no momento
  order_id uuid,                                            -- FK em 007
  order_item_id uuid,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind not in ('entrada') or quantity > 0),
  check (kind not in ('venda', 'uso', 'perda') or quantity < 0)
);
create index stock_movements_product_idx on public.stock_movements(product_id, created_at desc);
create index stock_movements_order_idx on public.stock_movements(order_id) where order_id is not null;

create or replace function public.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.products where id = new.product_id and salon_id = new.salon_id) then
    raise exception 'Referência de outro salão';
  end if;
  new.created_by := coalesce(new.created_by, auth.uid());
  if new.unit_cost is null then
    select cost_price / package_size into new.unit_cost from public.products where id = new.product_id;
  end if;
  update public.products set current_stock = current_stock + new.quantity where id = new.product_id;
  return new;
end $$;
create trigger trg_stock_apply before insert on public.stock_movements
  for each row execute function public.apply_stock_movement();

create trigger trg_audit_stock_movements after insert or update or delete on public.stock_movements
  for each row execute function public.write_audit_log();

-- Consumo por serviço: quanto de cada produto de uso um serviço gasta
create table public.service_supplies (
  salon_id uuid not null references public.salons(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity numeric(10,3) not null check (quantity > 0),   -- unidade base do produto
  primary key (service_id, product_id)
);

create trigger trg_supplies_same_salon before insert or update on public.service_supplies
  for each row execute function public.assert_same_salon();

-- ---------------------------------------------------------------------
-- Pacotes: catálogo (ex.: 4 escovas por R$ 240) e o que cada cliente comprou
-- ---------------------------------------------------------------------
create table public.packages (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  price numeric(10,2) not null check (price >= 0),
  validity_days int check (validity_days is null or validity_days > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_packages_updated before update on public.packages
  for each row execute function public.set_updated_at();

create table public.package_items (
  salon_id uuid not null references public.salons(id) on delete cascade,
  package_id uuid not null references public.packages(id) on delete cascade,
  service_id uuid not null references public.services(id),
  sessions int not null check (sessions between 1 and 100),
  primary key (package_id, service_id)
);
create trigger trg_package_items_same_salon before insert or update on public.package_items
  for each row execute function public.assert_same_salon();

create table public.client_packages (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  package_id uuid not null references public.packages(id),
  name text not null,                     -- cópia do nome na venda
  price numeric(10,2) not null,
  order_id uuid,                          -- FK em 007
  purchased_at timestamptz not null default now(),
  expires_at timestamptz,
  status text not null default 'ativo' check (status in ('ativo', 'cancelado')),
  created_at timestamptz not null default now()
);
create index client_packages_client_idx on public.client_packages(client_id, purchased_at desc);

create table public.client_package_balances (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_package_id uuid not null references public.client_packages(id) on delete cascade,
  service_id uuid not null references public.services(id),
  sessions_total int not null check (sessions_total > 0),
  sessions_used int not null default 0 check (sessions_used >= 0),
  unit_value numeric(10,2) not null default 0,   -- parte do preço do pacote por sessão (base da comissão)
  check (sessions_used <= sessions_total),
  unique (client_package_id, service_id)
);

-- Saldo de pacotes por cliente (o que ainda dá para usar)
create or replace view public.client_package_overview with (security_invoker = true) as
select
  b.id as balance_id,
  cp.id as client_package_id,
  cp.salon_id,
  cp.client_id,
  c.name as client_name,
  cp.name as package_name,
  cp.purchased_at,
  cp.expires_at,
  cp.status,
  b.service_id,
  s.name as service_name,
  b.sessions_total,
  b.sessions_used,
  b.sessions_total - b.sessions_used as sessions_left,
  (cp.status = 'ativo' and (cp.expires_at is null or cp.expires_at > now()) and b.sessions_used < b.sessions_total) as usable
from public.client_package_balances b
join public.client_packages cp on cp.id = b.client_package_id
join public.services s on s.id = b.service_id
join public.clients c on c.id = cp.client_id;

grant select on public.client_package_overview to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- Produtos/pacotes: todos leem; admin cadastra. Estoque: recepção lança
-- entradas; admin também ajusta e registra perdas. Saldo nunca é editado
-- direto: só por movimentação.
-- ---------------------------------------------------------------------
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;
alter table public.service_supplies enable row level security;
alter table public.packages enable row level security;
alter table public.package_items enable row level security;
alter table public.client_packages enable row level security;
alter table public.client_package_balances enable row level security;

create policy products_select on public.products for select to authenticated
  using (public.is_salon_member(salon_id));
create policy products_insert on public.products for insert to authenticated
  with check (public.is_salon_admin(salon_id));
create policy products_update on public.products for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

revoke insert, update on public.products from authenticated;
grant insert (salon_id, name, brand, barcode, unit, package_size, for_sale, for_use, cost_price, sale_price, commission_pct, min_stock, active)
  on public.products to authenticated;
grant update (name, brand, barcode, unit, package_size, for_sale, for_use, cost_price, sale_price, commission_pct, min_stock, active)
  on public.products to authenticated;

create policy stock_select on public.stock_movements for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy stock_insert on public.stock_movements for insert to authenticated
  with check (
    order_id is null and order_item_id is null
    and (
      (kind = 'entrada' and public.is_salon_staff(salon_id))
      or (kind in ('ajuste', 'perda') and public.is_salon_admin(salon_id))
    )
  );
-- sem update/delete: corrigir com um ajuste

create policy supplies_select on public.service_supplies for select to authenticated
  using (public.is_salon_member(salon_id));
create policy supplies_write on public.service_supplies for all to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy packages_select on public.packages for select to authenticated
  using (public.is_salon_member(salon_id));
create policy packages_insert on public.packages for insert to authenticated
  with check (public.is_salon_admin(salon_id));
create policy packages_update on public.packages for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy package_items_select on public.package_items for select to authenticated
  using (public.is_salon_member(salon_id));
create policy package_items_write on public.package_items for all to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

-- Pacotes vendidos nascem e mudam só pelo fechamento/cancelamento da comanda
create policy client_packages_select on public.client_packages for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy client_package_balances_select on public.client_package_balances for select to authenticated
  using (public.is_salon_staff(salon_id));
