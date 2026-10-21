-- =====================================================================
-- Salon OS · 003 · Clientes, ficha técnica e fotos
-- Ficha técnica (alergias) e fotos são dados sensíveis (LGPD):
-- bucket privado, consentimento registrado e acesso por papel.
-- =====================================================================

create type public.client_origin as enum (
  'indicacao', 'instagram', 'whatsapp', 'google', 'meta_ads', 'link_online', 'passante', 'outro'
);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  phone text,                                       -- E.164 sem "+", ex.: 5511999998888
  email text,
  birth_date date,
  gender text,
  origin public.client_origin not null default 'outro',
  referred_by_client_id uuid references public.clients(id) on delete set null,
  tags text[] not null default '{}',
  notes text,
  opt_out boolean not null default false,           -- não recebe WhatsApp de marketing
  lost_at timestamptz,                               -- marcado manualmente como "Perdido"
  lost_reason text,
  photo_consent_at timestamptz,                      -- consentimento para fotos antes/depois
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_salon_idx on public.clients(salon_id) where archived_at is null;
create unique index clients_salon_phone_uniq on public.clients(salon_id, phone)
  where phone is not null and archived_at is null;
create index clients_name_search_idx on public.clients using gin (to_tsvector('simple', name));
create trigger trg_clients_updated before update on public.clients
  for each row execute function public.set_updated_at();

-- Ficha técnica: uma linha por registro (histórico de fórmulas)
create type public.tech_note_kind as enum ('coloracao', 'cabelo', 'unhas', 'pele', 'alergia', 'geral');

create table public.client_notes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  kind public.tech_note_kind not null default 'geral',
  title text,
  body text not null,
  -- dados estruturados opcionais (ex.: {"marca":"Wella","tom":"7.1","ox":"20vol","tempo_min":35})
  data jsonb not null default '{}'::jsonb,
  professional_id uuid references public.professionals(id) on delete set null,
  appointment_id uuid,                               -- FK adicionada em 004
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index client_notes_client_idx on public.client_notes(client_id, created_at desc);

create table public.client_photos (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  storage_path text not null unique,                 -- {salon_id}/{client_id}/{uuid}.jpg
  kind text not null default 'antes' check (kind in ('antes', 'depois', 'referencia')),
  caption text,
  appointment_id uuid,                               -- FK adicionada em 004
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index client_photos_client_idx on public.client_photos(client_id, created_at desc);

create or replace function public.assert_client_same_salon()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.clients c where c.id = new.client_id and c.salon_id = new.salon_id) then
    raise exception 'Cliente de outro salão';
  end if;
  return new;
end $$;
create trigger trg_client_notes_same_salon before insert or update on public.client_notes
  for each row execute function public.assert_client_same_salon();
create trigger trg_client_photos_same_salon before insert or update on public.client_photos
  for each row execute function public.assert_client_same_salon();

-- Fotos só com consentimento registrado
create or replace function public.assert_photo_consent()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.clients where id = new.client_id and photo_consent_at is not null) then
    raise exception 'Registre o consentimento do cliente antes de salvar fotos';
  end if;
  return new;
end $$;
create trigger trg_client_photos_consent before insert on public.client_photos
  for each row execute function public.assert_photo_consent();

-- ---------------------------------------------------------------------
-- Profissional enxerga só clientes que já atendeu ou tem marcados.
-- A função é definida aqui e recriada em 004 quando a agenda existir.
-- ---------------------------------------------------------------------
create or replace function public.professional_can_see_client(p_salon_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select false
$$;

create or replace function public.can_see_client(p_salon_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_salon_staff(p_salon_id)
      or (public.salon_role_of(p_salon_id) = 'profissional'
          and public.professional_can_see_client(p_salon_id, p_client_id))
$$;

alter table public.clients enable row level security;
alter table public.client_notes enable row level security;
alter table public.client_photos enable row level security;

create policy clients_select on public.clients for select to authenticated
  using (public.can_see_client(salon_id, id));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_salon_staff(salon_id));
create policy clients_update on public.clients for update to authenticated
  using (public.is_salon_staff(salon_id)) with check (public.is_salon_staff(salon_id));
-- sem delete: arquivar (archived_at)

create policy client_notes_select on public.client_notes for select to authenticated
  using (public.can_see_client(salon_id, client_id));
create policy client_notes_insert on public.client_notes for insert to authenticated
  with check (public.can_see_client(salon_id, client_id) and created_by = auth.uid());
create policy client_notes_update on public.client_notes for update to authenticated
  using (public.is_salon_staff(salon_id) or created_by = auth.uid())
  with check (public.can_see_client(salon_id, client_id));

create policy client_photos_select on public.client_photos for select to authenticated
  using (public.can_see_client(salon_id, client_id));
create policy client_photos_insert on public.client_photos for insert to authenticated
  with check (public.can_see_client(salon_id, client_id) and created_by = auth.uid());
create policy client_photos_update on public.client_photos for update to authenticated
  using (public.is_salon_staff(salon_id) or created_by = auth.uid())
  with check (public.can_see_client(salon_id, client_id));

-- ---------------------------------------------------------------------
-- Storage: bucket privado client-photos, caminho {salon_id}/{client_id}/arquivo
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-photos', 'client-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy client_photos_obj_select on storage.objects for select to authenticated
  using (
    bucket_id = 'client-photos'
    and public.can_see_client(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid)
  );
create policy client_photos_obj_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'client-photos'
    and public.can_see_client(((storage.foldername(name))[1])::uuid, ((storage.foldername(name))[2])::uuid)
  );
