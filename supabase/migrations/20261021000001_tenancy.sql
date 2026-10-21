-- =====================================================================
-- Salon OS · 001 · Tenancy: salões, membros, papéis, convites
-- Toda tabela de negócio tem salon_id e RLS. Papéis são POR SALÃO.
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

create type public.salon_role as enum ('admin', 'recepcao', 'profissional');

-- ---------------------------------------------------------------------
-- Salões
-- ---------------------------------------------------------------------
create table public.salons (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  whatsapp text,
  email text,
  address_street text,
  address_number text,
  address_district text,
  address_city text,
  address_state text,
  address_zip text,
  timezone text not null default 'America/Sao_Paulo',
  -- {"1": [["09:00","19:00"]], ...} chave = dia da semana ISO (1 = segunda ... 7 = domingo)
  business_hours jsonb not null default '{}'::jsonb,
  -- Base de cálculo de comissão (usada na Fase 2)
  commission_base text not null default 'bruto' check (commission_base in ('bruto', 'liquido')),
  commission_deduct_card_fee boolean not null default false,
  commission_deduct_product_cost boolean not null default false,
  onboarding_completed boolean not null default false,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Perfis (1 por usuário do auth)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  avatar_url text,
  current_salon_id uuid references public.salons(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Donos do SaaS (Painel SaaS na Fase 5)
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Membros de um salão. professional_id é ligado em 003 (catálogo).
create table public.salon_members (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.salon_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (salon_id, user_id)
);
create index salon_members_user_idx on public.salon_members(user_id) where active;

-- Convites por e-mail (expiram em 7 dias)
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  email text not null check (email = lower(trim(email))),
  role public.salon_role not null,
  full_name text,
  token uuid not null unique default gen_random_uuid(),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_one_pending_per_email
  on public.invitations(salon_id, email)
  where accepted_at is null and revoked_at is null;

-- ---------------------------------------------------------------------
-- Funções auxiliares (security definer evita recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger trg_salons_updated before update on public.salons
  for each row execute function public.set_updated_at();
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger trg_salon_members_updated before update on public.salon_members
  for each row execute function public.set_updated_at();

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Papel do usuário atual no salão (null se não for membro ativo ou o salão estiver suspenso)
create or replace function public.salon_role_of(p_salon_id uuid)
returns public.salon_role language sql stable security definer set search_path = public as $$
  select m.role
  from public.salon_members m
  join public.salons s on s.id = m.salon_id
  where m.salon_id = p_salon_id
    and m.user_id = auth.uid()
    and m.active
    and s.suspended_at is null
$$;

create or replace function public.is_salon_member(p_salon_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.salon_role_of(p_salon_id) is not null
$$;

create or replace function public.has_salon_role(p_salon_id uuid, p_roles public.salon_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.salon_role_of(p_salon_id) = any(p_roles), false)
$$;

-- Atalhos mais legíveis nas policies
create or replace function public.is_salon_admin(p_salon_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_salon_role(p_salon_id, array['admin']::public.salon_role[])
$$;

create or replace function public.is_salon_staff(p_salon_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_salon_role(p_salon_id, array['admin', 'recepcao']::public.salon_role[])
$$;

-- ---------------------------------------------------------------------
-- Novo usuário → perfil. O salão é criado no onboarding (create_salon)
-- ou o usuário entra num salão existente pelo convite (accept_invitation).
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    lower(new.email),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Gera um slug único a partir do nome
create or replace function public.unique_salon_slug(p_name text)
returns text language plpgsql security definer set search_path = public as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  base := lower(regexp_replace(
    translate(p_name,
      'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ',
      'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn'),
    '[^a-zA-Z0-9]+', '-', 'g'));
  base := trim(both '-' from base);
  if base = '' then base := 'salao'; end if;
  candidate := base;
  while exists (select 1 from public.salons where slug = candidate) loop
    n := n + 1;
    candidate := base || '-' || n;
  end loop;
  return candidate;
end $$;

-- Cria um salão com o usuário atual como admin e o torna o salão ativo
create or replace function public.create_salon(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '28000';
  end if;
  insert into public.salons (name, slug)
  values (trim(p_name), public.unique_salon_slug(p_name))
  returning id into v_id;
  insert into public.salon_members (salon_id, user_id, role) values (v_id, auth.uid(), 'admin');
  update public.profiles set current_salon_id = v_id where id = auth.uid();
  return v_id;
end $$;

-- Aceita um convite pelo token. O e-mail do usuário precisa bater com o convite.
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

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  update public.profiles
    set current_salon_id = inv.salon_id,
        full_name = coalesce(nullif(full_name, ''), inv.full_name)
    where id = auth.uid();
  return inv.salon_id;
end $$;

-- Troca o salão ativo (usuário membro de mais de um salão)
create or replace function public.switch_salon(p_salon_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_salon_member(p_salon_id) then
    raise exception 'Você não faz parte deste salão';
  end if;
  update public.profiles set current_salon_id = p_salon_id where id = auth.uid();
end $$;

-- Impede o salão de ficar sem nenhum admin ativo
create or replace function public.guard_last_admin()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid := coalesce(old.salon_id, new.salon_id);
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)) then
    if not exists (
      select 1 from public.salon_members
      where salon_id = v_salon and role = 'admin' and active and id <> old.id
    ) then
      raise exception 'O salão precisa de pelo menos um administrador ativo';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger trg_guard_last_admin
  before update or delete on public.salon_members
  for each row execute function public.guard_last_admin();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.salons enable row level security;
alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.salon_members enable row level security;
alter table public.invitations enable row level security;

-- salons
create policy salons_select on public.salons for select to authenticated
  using (public.is_salon_member(id) or public.is_platform_admin());
create policy salons_update on public.salons for update to authenticated
  using (public.is_salon_admin(id)) with check (public.is_salon_admin(id));
-- insert só por create_salon(); delete nunca (suspender em vez de apagar)

-- profiles: o próprio, e colegas do mesmo salão (nome na agenda, equipe)
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.salon_members mine
      join public.salon_members theirs on theirs.salon_id = mine.salon_id
      where mine.user_id = auth.uid() and mine.active and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- platform_admins: cada um vê só a própria linha
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- salon_members
create policy members_select on public.salon_members for select to authenticated
  using (user_id = auth.uid() or public.is_salon_member(salon_id));
create policy members_update on public.salon_members for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));
create policy members_delete on public.salon_members for delete to authenticated
  using (public.is_salon_admin(salon_id) and user_id <> auth.uid());
-- insert só por create_salon() / accept_invitation()

-- invitations: só admin do salão
create policy invitations_select on public.invitations for select to authenticated
  using (public.is_salon_admin(salon_id));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (public.is_salon_admin(salon_id) and invited_by = auth.uid());
create policy invitations_update on public.invitations for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

-- Convite público: dados mínimos para a tela "Você foi convidado"
create or replace function public.invitation_preview(p_token uuid)
returns table (salon_name text, email text, role public.salon_role, expired boolean, used boolean)
language sql stable security definer set search_path = public as $$
  select s.name, i.email, i.role, i.expires_at < now(), (i.accepted_at is not null or i.revoked_at is not null)
  from public.invitations i join public.salons s on s.id = i.salon_id
  where i.token = p_token
$$;

revoke execute on function public.create_salon(text) from public, anon;
revoke execute on function public.accept_invitation(uuid) from public, anon;
revoke execute on function public.switch_salon(uuid) from public, anon;
grant execute on function public.create_salon(text) to authenticated;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.switch_salon(uuid) to authenticated;
grant execute on function public.invitation_preview(uuid) to anon, authenticated;
