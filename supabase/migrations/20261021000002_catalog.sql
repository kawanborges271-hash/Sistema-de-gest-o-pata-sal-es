-- =====================================================================
-- Salon OS · 002 · Cadastros: serviços, profissionais, jornada, bloqueios
-- =====================================================================

-- ---------------------------------------------------------------------
-- Serviços
-- ---------------------------------------------------------------------
create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (salon_id, name)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  category_id uuid references public.service_categories(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  description text,
  duration_minutes int not null check (duration_minutes between 5 and 720),
  price numeric(10,2) not null default 0 check (price >= 0),
  price_is_starting boolean not null default false,       -- preço "a partir de"
  return_interval_days int check (return_interval_days is null or return_interval_days > 0),
  default_commission_pct numeric(5,2) not null default 0 check (default_commission_pct between 0 and 100),
  online_booking boolean not null default true,           -- aparece no link público (Fase 3)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index services_salon_idx on public.services(salon_id) where active;
create trigger trg_services_updated before update on public.services
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- Profissionais
-- ---------------------------------------------------------------------
create table public.professionals (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  role_title text,                                         -- cargo: cabeleireira, manicure...
  phone text,
  email text,
  color text not null default '#B87A5E' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  default_commission_pct numeric(5,2) not null default 0 check (default_commission_pct between 0 and 100),
  user_id uuid references auth.users(id) on delete set null,  -- login do profissional (opcional)
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, user_id)
);
create trigger trg_professionals_updated before update on public.professionals
  for each row execute function public.set_updated_at();

-- Serviços que cada profissional faz, com preço/duração/comissão próprios opcionais
create table public.professional_services (
  salon_id uuid not null references public.salons(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  price numeric(10,2) check (price is null or price >= 0),
  duration_minutes int check (duration_minutes is null or duration_minutes between 5 and 720),
  commission_pct numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  primary key (professional_id, service_id)
);
create index professional_services_service_idx on public.professional_services(service_id);

-- Jornada: várias faixas por dia; o vão entre faixas é o intervalo (almoço etc.)
create table public.professional_hours (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  professional_id uuid not null references public.professionals(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),  -- ISO: 1 = segunda ... 7 = domingo
  start_time time not null,
  end_time time not null,
  check (end_time > start_time),
  exclude using gist (
    professional_id with =,
    weekday with =,
    tsrange('2000-01-01'::date + start_time, '2000-01-01'::date + end_time) with &&
  )
);
create index professional_hours_prof_idx on public.professional_hours(professional_id, weekday);

-- Bloqueios pontuais: folga, almoço, curso, férias. professional_id nulo = salão inteiro.
create type public.block_kind as enum ('folga', 'almoco', 'bloqueio', 'ferias', 'feriado');

create table public.schedule_blocks (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  professional_id uuid references public.professionals(id) on delete cascade,
  kind public.block_kind not null default 'bloqueio',
  reason text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index schedule_blocks_range_idx on public.schedule_blocks using gist (salon_id, tstzrange(starts_at, ends_at));

-- O professional_id do membro (papel profissional) é o professionals.user_id
create or replace function public.my_professional_id(p_salon_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.professionals
  where salon_id = p_salon_id and user_id = auth.uid()
  limit 1
$$;

-- Garante que referências entre tabelas não cruzem salões
create or replace function public.assert_same_salon()
returns trigger language plpgsql as $$
declare
  v_row jsonb := to_jsonb(new);
begin
  if v_row ? 'category_id' and v_row ->> 'category_id' is not null
     and not exists (select 1 from public.service_categories
                     where id = (v_row ->> 'category_id')::uuid and salon_id = new.salon_id) then
    raise exception 'Referência de outro salão';
  end if;
  if v_row ? 'professional_id' and v_row ->> 'professional_id' is not null
     and not exists (select 1 from public.professionals
                     where id = (v_row ->> 'professional_id')::uuid and salon_id = new.salon_id) then
    raise exception 'Referência de outro salão';
  end if;
  if v_row ? 'service_id' and v_row ->> 'service_id' is not null
     and not exists (select 1 from public.services
                     where id = (v_row ->> 'service_id')::uuid and salon_id = new.salon_id) then
    raise exception 'Referência de outro salão';
  end if;
  return new;
end $$;

create trigger trg_services_same_salon before insert or update on public.services
  for each row execute function public.assert_same_salon();
create trigger trg_prof_services_same_salon before insert or update on public.professional_services
  for each row execute function public.assert_same_salon();
create trigger trg_prof_hours_same_salon before insert or update on public.professional_hours
  for each row execute function public.assert_same_salon();
create trigger trg_blocks_same_salon before insert or update on public.schedule_blocks
  for each row execute function public.assert_same_salon();

-- ---------------------------------------------------------------------
-- RLS: todos os membros leem o catálogo; admin edita.
-- Bloqueios: admin e recepção criam/editam; o profissional cria os próprios.
-- ---------------------------------------------------------------------
alter table public.service_categories enable row level security;
alter table public.services enable row level security;
alter table public.professionals enable row level security;
alter table public.professional_services enable row level security;
alter table public.professional_hours enable row level security;
alter table public.schedule_blocks enable row level security;

create policy categories_select on public.service_categories for select to authenticated
  using (public.is_salon_member(salon_id));
create policy categories_write on public.service_categories for all to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy services_select on public.services for select to authenticated
  using (public.is_salon_member(salon_id));
create policy services_insert on public.services for insert to authenticated
  with check (public.is_salon_admin(salon_id));
create policy services_update on public.services for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));
-- sem delete: inativar preserva o histórico

create policy professionals_select on public.professionals for select to authenticated
  using (public.is_salon_member(salon_id));
create policy professionals_insert on public.professionals for insert to authenticated
  with check (public.is_salon_admin(salon_id));
create policy professionals_update on public.professionals for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy prof_services_select on public.professional_services for select to authenticated
  using (public.is_salon_member(salon_id));
create policy prof_services_write on public.professional_services for all to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy prof_hours_select on public.professional_hours for select to authenticated
  using (public.is_salon_member(salon_id));
create policy prof_hours_write on public.professional_hours for all to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy blocks_select on public.schedule_blocks for select to authenticated
  using (public.is_salon_member(salon_id));
create policy blocks_write on public.schedule_blocks for all to authenticated
  using (
    public.is_salon_staff(salon_id)
    or (professional_id is not null and professional_id = public.my_professional_id(salon_id))
  )
  with check (
    public.is_salon_staff(salon_id)
    or (professional_id is not null and professional_id = public.my_professional_id(salon_id))
  );
