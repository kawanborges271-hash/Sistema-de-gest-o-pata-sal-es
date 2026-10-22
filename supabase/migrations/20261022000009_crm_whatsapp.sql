-- =====================================================================
-- Salon OS · 009 · CRM, WhatsApp (Z-API) e automações
--
-- Integração: as credenciais da Z-API ficam numa tabela sem nenhuma policy.
-- O front só enxerga o status por RPC; o token nunca volta para o navegador.
-- Quem lê as credenciais são as Edge Functions, com a service role.
--
-- Fila: toda mensagem passa por message_queue. As automações e campanhas
-- só enfileiram; quem envia é a Edge Function whatsapp-dispatch, que pede
-- um lote a claim_whatsapp_messages() respeitando janela de envio, limite
-- diário, espaçamento, opt-out e 3 tentativas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Telefones: Z-API manda 5511999998888, às vezes sem o 9 do celular.
-- phone_key compara pelo país + DDD + 8 últimos dígitos.
-- ---------------------------------------------------------------------
create or replace function public.normalize_phone(p text)
returns text language sql immutable as $$
  select case
    when d = '' then null
    when length(d) in (10, 11) then '55' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create or replace function public.phone_key(p text)
returns text language sql immutable as $$
  select case
    when d ~ '^55\d{10,11}$' then substr(d, 1, 4) || right(d, 8)
    else nullif(d, '')
  end
  from (select coalesce(public.normalize_phone(p), '') as d) x
$$;

create index clients_phone_key_idx on public.clients(salon_id, public.phone_key(phone)) where phone is not null;

-- Clientes criados pela demonstração nunca recebem WhatsApp de verdade
alter table public.clients add column is_demo boolean not null default false;

-- ---------------------------------------------------------------------
-- Configurações do salão para mensagens
-- ---------------------------------------------------------------------
alter table public.salons
  add column app_url text,                                   -- origem do app, para montar {link_agendamento}
  add column google_review_url text,
  add column wa_window_start time not null default '08:00',
  add column wa_window_end time not null default '20:00',
  add column wa_daily_limit int not null default 150 check (wa_daily_limit between 1 and 5000),
  add column wa_spacing_seconds int not null default 30 check (wa_spacing_seconds between 5 and 600),
  add constraint salons_wa_window check (wa_window_end > wa_window_start);

-- Status de agendamento: falta e pedido de remarcação (resposta NÃO)
alter table public.appointments
  add column no_show_at timestamptz,
  add column reschedule_requested_at timestamptz;

create or replace function public.on_appointment_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'confirmado' then new.confirmed_at := coalesce(new.confirmed_at, now());
      when 'em_atendimento' then new.checked_in_at := coalesce(new.checked_in_at, now());
      when 'concluido' then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelado' then new.cancelled_at := coalesce(new.cancelled_at, now());
      when 'nao_compareceu' then new.no_show_at := coalesce(new.no_show_at, now());
      else null;
    end case;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Integração Z-API (segredo: sem policies, só service role e RPCs)
-- ---------------------------------------------------------------------
create table public.whatsapp_integrations (
  salon_id uuid primary key references public.salons(id) on delete cascade,
  provider text not null default 'zapi' check (provider = 'zapi'),
  instance_id text,
  token text,
  client_token text,
  phone text,
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  active boolean not null default false,
  status text not null default 'pendente' check (status in ('pendente', 'conectado', 'desconectado', 'erro')),
  last_error text,
  last_checked_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_whatsapp_integrations_updated before update on public.whatsapp_integrations
  for each row execute function public.set_updated_at();
alter table public.whatsapp_integrations enable row level security;
revoke all on public.whatsapp_integrations from anon, authenticated;

-- Status para a tela de Configurações (admin). Nunca devolve o token.
create or replace function public.whatsapp_integration_status(p_salon_id uuid)
returns table (
  configured boolean, active boolean, instance_id text, phone text, status text,
  token_hint text, client_token_set boolean, webhook_secret text,
  last_checked_at timestamptz, last_error text, connected_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador do salão vê a integração' using errcode = '42501';
  end if;
  return query
  select w.instance_id is not null and w.token is not null, w.active, w.instance_id, w.phone, w.status,
         case when w.token is not null then '••••' || right(w.token, 4) end,
         w.client_token is not null, w.webhook_secret,
         w.last_checked_at, w.last_error, w.connected_at
  from public.whatsapp_integrations w where w.salon_id = p_salon_id;
end $$;

-- Salva credenciais. Token/Client-Token nulos = manter os atuais.
create or replace function public.save_whatsapp_integration(
  p_salon_id uuid, p_instance_id text, p_token text default null,
  p_client_token text default null, p_phone text default null, p_app_url text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Só o administrador do salão configura o WhatsApp' using errcode = '42501';
  end if;
  if coalesce(trim(p_instance_id), '') !~ '^[A-Za-z0-9_-]{6,80}$' then
    raise exception 'ID da instância inválido';
  end if;
  if p_token is not null and trim(p_token) !~ '^[A-Za-z0-9_-]{6,120}$' then
    raise exception 'Token inválido';
  end if;
  insert into public.whatsapp_integrations (salon_id, instance_id, token, client_token, phone, active, status)
  values (p_salon_id, trim(p_instance_id), nullif(trim(p_token), ''), nullif(trim(p_client_token), ''),
          public.normalize_phone(p_phone), true, 'pendente')
  on conflict (salon_id) do update
     set instance_id = excluded.instance_id,
         token = coalesce(excluded.token, whatsapp_integrations.token),
         client_token = coalesce(excluded.client_token, whatsapp_integrations.client_token),
         phone = coalesce(excluded.phone, whatsapp_integrations.phone),
         active = true,
         status = case when whatsapp_integrations.instance_id is distinct from excluded.instance_id
                         or excluded.token is not null then 'pendente' else whatsapp_integrations.status end;
  if not exists (select 1 from public.whatsapp_integrations where salon_id = p_salon_id and token is not null) then
    raise exception 'Informe o token da instância';
  end if;
  if p_app_url ~ '^https?://' then
    update public.salons set app_url = rtrim(p_app_url, '/') where id = p_salon_id;
  end if;
end $$;

create or replace function public.set_whatsapp_active(p_salon_id uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  update public.whatsapp_integrations set active = p_active where salon_id = p_salon_id;
end $$;

-- Novo segredo do webhook: a URL antiga para de funcionar na hora
create or replace function public.rotate_whatsapp_webhook_secret(p_salon_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v text := encode(gen_random_bytes(24), 'hex');
begin
  if not public.is_salon_admin(p_salon_id) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  insert into public.whatsapp_integrations (salon_id, webhook_secret) values (p_salon_id, v)
  on conflict (salon_id) do update set webhook_secret = v;
  return v;
end $$;

-- Só para as Edge Functions (service role)
create or replace function public.whatsapp_credentials(p_salon_id uuid)
returns table (instance_id text, token text, client_token text, webhook_secret text, phone text)
language sql stable security definer set search_path = public as $$
  select instance_id, token, client_token, webhook_secret, phone
  from public.whatsapp_integrations where salon_id = p_salon_id
$$;

create or replace function public.set_whatsapp_status(p_salon_id uuid, p_status text, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.whatsapp_integrations
     set status = p_status,
         last_error = p_error,
         last_checked_at = now(),
         connected_at = case when p_status = 'conectado' then coalesce(connected_at, now()) else connected_at end
   where salon_id = p_salon_id
$$;

-- ---------------------------------------------------------------------
-- Notificações (sino do topo)
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  roles public.salon_role[] not null default '{admin,recepcao}',
  created_at timestamptz not null default now()
);
create index notifications_salon_idx on public.notifications(salon_id, created_at desc);

create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create or replace function public.notify(
  p_salon_id uuid, p_kind text, p_title text, p_body text default null, p_link text default null,
  p_roles public.salon_role[] default '{admin,recepcao}'
) returns uuid language sql security definer set search_path = public as $$
  insert into public.notifications (salon_id, kind, title, body, link, roles)
  values (p_salon_id, p_kind, p_title, p_body, p_link, p_roles)
  returning id
$$;

create or replace function public.mark_notifications_read(p_salon_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.notifications n
  where n.salon_id = p_salon_id and public.salon_role_of(p_salon_id) = any(n.roles)
  on conflict do nothing
$$;

-- ---------------------------------------------------------------------
-- CRM: leads e histórico de etapas
-- ---------------------------------------------------------------------
create type public.lead_stage as enum (
  'novo', 'em_contato', 'agendado', 'follow_up', 'cliente', 'nao_compareceu', 'base_fria', 'perdido'
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  phone text,
  origin public.client_origin not null default 'outro',
  stage public.lead_stage not null default 'novo',
  stage_changed_at timestamptz not null default now(),
  interest text,                                   -- o que a pessoa quer (ex.: "mechas")
  notes text,
  next_follow_up_at timestamptz,
  lost_reason text,
  last_message text,
  last_message_at timestamptz,
  last_message_direction text check (last_message_direction in ('in', 'out')),
  converted_at timestamptz,                        -- primeira vez que virou cliente
  assigned_to uuid references auth.users(id) on delete set null,
  archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage <> 'perdido' or length(trim(coalesce(lost_reason, ''))) > 0)
);
create index leads_salon_stage_idx on public.leads(salon_id, stage) where archived_at is null;
create unique index leads_salon_phone_uniq on public.leads(salon_id, public.phone_key(phone))
  where phone is not null and archived_at is null;
create unique index leads_salon_client_uniq on public.leads(salon_id, client_id)
  where client_id is not null and archived_at is null;
create trigger trg_leads_updated before update on public.leads
  for each row execute function public.set_updated_at();
create trigger trg_leads_client_same_salon before insert or update of client_id on public.leads
  for each row when (new.client_id is not null) execute function public.assert_client_same_salon();

create table public.lead_stage_history (
  id bigint generated always as identity primary key,
  salon_id uuid not null references public.salons(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage public.lead_stage,
  to_stage public.lead_stage not null,
  reason text,
  automatic boolean not null default false,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index lead_stage_history_lead_idx on public.lead_stage_history(lead_id, changed_at desc);

-- Etapa automática (agenda, webhook, rotina) marca a mudança como automática
create or replace function public.lead_auto_move(p_lead_id uuid, p_stage public.lead_stage, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.lead_auto', '1', true);
  update public.leads set stage = p_stage where id = p_lead_id and stage is distinct from p_stage;
  perform set_config('app.lead_auto', '', true);
end $$;

-- BEFORE para preencher as datas; o histórico referencia o lead, então no
-- INSERT ele é gravado depois (trigger AFTER abaixo).
create or replace function public.on_lead_stage_before()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    if new.stage = 'cliente' then new.converted_at := coalesce(new.converted_at, now()); end if;
  end if;
  if new.stage <> 'perdido' then new.lost_reason := null; end if;
  new.phone := public.normalize_phone(new.phone);
  return new;
end $$;
create or replace function public.on_lead_stage_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    insert into public.lead_stage_history (salon_id, lead_id, from_stage, to_stage, reason, automatic, changed_by)
    values (new.salon_id, new.id, case when tg_op = 'UPDATE' then old.stage end, new.stage,
            case when new.stage = 'perdido' then new.lost_reason end,
            coalesce(current_setting('app.lead_auto', true), '') = '1', auth.uid());
  end if;
  return null;
end $$;
create trigger trg_leads_stage_before before insert or update on public.leads
  for each row execute function public.on_lead_stage_before();
create trigger trg_leads_stage_after after insert or update of stage on public.leads
  for each row execute function public.on_lead_stage_after();

-- Cliente novo com o telefone de um lead: liga os dois
create or replace function public.link_lead_to_new_client()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is not null then
    update public.leads set client_id = new.id
     where salon_id = new.salon_id and client_id is null and archived_at is null
       and public.phone_key(phone) = public.phone_key(new.phone);
  end if;
  return null;
end $$;
create trigger trg_clients_link_lead after insert on public.clients
  for each row execute function public.link_lead_to_new_client();

-- Lead → cliente (ou liga a um cliente com o mesmo telefone)
create or replace function public.convert_lead(p_lead_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
  v_client uuid;
begin
  select * into l from public.leads where id = p_lead_id for update;
  if not found or not public.is_salon_staff(l.salon_id) then
    raise exception 'Lead não encontrado' using errcode = '42501';
  end if;
  if l.client_id is not null then
    return l.client_id;
  end if;
  if l.phone is not null then
    select id into v_client from public.clients
     where salon_id = l.salon_id and archived_at is null and public.phone_key(phone) = public.phone_key(l.phone)
     limit 1;
  end if;
  if v_client is null then
    insert into public.clients (salon_id, name, phone, origin, notes, created_by)
    values (l.salon_id, l.name, l.phone, l.origin, l.interest, auth.uid())
    returning id into v_client;
  end if;
  update public.leads set client_id = v_client where id = l.id;
  return v_client;
end $$;

-- O card anda sozinho conforme a agenda
create or replace function public.on_appointment_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  l public.leads;
  v_target public.lead_stage;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select * into l from public.leads
   where salon_id = new.salon_id and client_id = new.client_id and archived_at is null
   for update;
  if not found then
    return null;
  end if;
  v_target := case
    when tg_op = 'INSERT' and new.status in ('agendado', 'confirmado') and l.stage <> 'cliente' then 'agendado'
    when new.status = 'concluido' then 'cliente'
    when new.status = 'nao_compareceu' then 'nao_compareceu'
    when new.status = 'cancelado' and l.stage = 'agendado' and not exists (
      select 1 from public.appointments a
      where a.client_id = new.client_id and a.id <> new.id
        and a.status in ('agendado', 'confirmado') and a.starts_at > now()
    ) then 'follow_up'
  end::public.lead_stage;
  if v_target is not null then
    perform public.lead_auto_move(l.id, v_target);
  end if;
  return null;
end $$;
create trigger trg_appointments_lead after insert or update of status on public.appointments
  for each row execute function public.on_appointment_lead();

-- ---------------------------------------------------------------------
-- Opt-out (fonte da verdade para "nunca enviar") sincronizado com clients.opt_out
-- ---------------------------------------------------------------------
create table public.opt_outs (
  salon_id uuid not null references public.salons(id) on delete cascade,
  phone text not null,
  reason text not null default 'manual' check (reason in ('palavra_chave', 'manual')),
  source_message text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (salon_id, phone)
);
create unique index opt_outs_key_uniq on public.opt_outs(salon_id, public.phone_key(phone));

create or replace function public.is_opted_out(p_salon_id uuid, p_phone text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.opt_outs
    where salon_id = p_salon_id and public.phone_key(phone) = public.phone_key(p_phone)
  )
$$;

create or replace function public.on_opt_out_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.clients set opt_out = true
     where salon_id = new.salon_id and not opt_out and public.phone_key(phone) = public.phone_key(new.phone);
    -- mensagens na fila deixam de sair
    update public.message_queue set status = 'ignorada', last_error = 'Pediu para sair (opt-out)'
     where salon_id = new.salon_id and status = 'pendente' and kind <> 'resposta'
       and public.phone_key(phone) = public.phone_key(new.phone);
  else
    update public.clients set opt_out = false
     where salon_id = old.salon_id and opt_out and public.phone_key(phone) = public.phone_key(old.phone);
  end if;
  return null;
end $$;

create or replace function public.normalize_opt_out()
returns trigger language plpgsql as $$
begin
  new.phone := public.normalize_phone(new.phone);
  if new.phone is null then
    raise exception 'Telefone inválido';
  end if;
  return new;
end $$;
create trigger trg_opt_outs_normalize before insert on public.opt_outs
  for each row execute function public.normalize_opt_out();
create trigger trg_opt_outs_sync after insert or delete on public.opt_outs
  for each row execute function public.on_opt_out_change();

create or replace function public.on_client_opt_out()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.phone is null then
    return null;
  end if;
  if new.opt_out and (tg_op = 'INSERT' or not old.opt_out) then
    insert into public.opt_outs (salon_id, phone, reason, created_by)
    values (new.salon_id, new.phone, 'manual', auth.uid())
    on conflict do nothing;
  elsif tg_op = 'UPDATE' and old.opt_out and not new.opt_out then
    delete from public.opt_outs
     where salon_id = new.salon_id and public.phone_key(phone) = public.phone_key(new.phone);
  end if;
  return null;
end $$;
create trigger trg_clients_opt_out after insert or update of opt_out on public.clients
  for each row execute function public.on_client_opt_out();

-- ---------------------------------------------------------------------
-- Automações: uma linha por tipo e por salão, com texto editável
-- ---------------------------------------------------------------------
create type public.automation_kind as enum (
  'confirmacao_agendamento', 'lembrete_24h', 'confirmacao_2h', 'reagendamento', 'cancelamento',
  'pos_atendimento', 'avaliacao_google', 'retoque', 'recuperacao_falta', 'aniversario',
  'reativacao', 'pacote_acabando'
);

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  kind public.automation_kind not null,
  enabled boolean not null default true,
  template text not null check (length(trim(template)) between 5 and 1000),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (salon_id, kind)
);
create trigger trg_automations_updated before update on public.automations
  for each row execute function public.set_updated_at();

create or replace function public.seed_automations(p_salon_id uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.automations (salon_id, kind, template, settings) values
    (p_salon_id, 'confirmacao_agendamento',
     'Oi, {nome}! Seu horário no {salao} está marcado para {data}, às {hora}: {servico} com {profissional}. Responda SIM para confirmar ou NÃO se precisar remarcar.',
     '{}'),
    (p_salon_id, 'lembrete_24h',
     'Oi, {nome}! Passando para lembrar do seu horário amanhã, {data}, às {hora}: {servico} com {profissional}. Responda SIM para confirmar ou NÃO para remarcar.',
     '{"hours_before": 24}'),
    (p_salon_id, 'confirmacao_2h',
     '{nome}, seu horário é hoje às {hora} ({servico} com {profissional}). Podemos confirmar? Responda SIM ou NÃO.',
     '{"hours_before": 2}'),
    (p_salon_id, 'reagendamento',
     'Pronto, {nome}! Seu horário foi remarcado para {data}, às {hora}: {servico} com {profissional}. Qualquer coisa, é só responder por aqui.',
     '{}'),
    (p_salon_id, 'cancelamento',
     '{nome}, seu horário de {data}, às {hora}, foi cancelado. Quando quiser marcar de novo, escolha um horário aqui: {link_agendamento}',
     '{}'),
    (p_salon_id, 'pos_atendimento',
     'Oi, {nome}! Obrigada por vir ao {salao} ontem. De 0 a 10, quanto você indicaria o nosso atendimento? Responda só com o número.',
     '{"hour": "10:00"}'),
    (p_salon_id, 'avaliacao_google',
     'Que alegria, {nome}! Se puder, conte no Google como foi. Ajuda muito o nosso salão: {link_avaliacao}',
     '{"min_score": 9}'),
    (p_salon_id, 'retoque',
     'Oi, {nome}! Já está na hora de retocar: {servico}. Quer garantir seu horário? Escolha aqui: {link_agendamento}',
     '{"window_days": 7}'),
    (p_salon_id, 'recuperacao_falta',
     '{nome}, sentimos sua falta hoje às {hora}. Aconteceu alguma coisa? Se quiser, escolha um novo horário: {link_agendamento}',
     '{"hours_after": 2}'),
    (p_salon_id, 'aniversario',
     'Feliz aniversário, {nome}! Todo o time do {salao} deseja um dia lindo para você.',
     '{"hour": "09:00", "coupon": ""}'),
    (p_salon_id, 'reativacao',
     'Oi, {nome}! Faz tempo que você não vem ao {salao} e a gente sente sua falta. Que tal marcar um horário? {link_agendamento}',
     '{"days": 60, "daily_max": 5, "repeat_after_days": 60}'),
    (p_salon_id, 'pacote_acabando',
     '{nome}, seu pacote {pacote} está acabando ({detalhe_pacote}). Quer marcar a próxima sessão ou renovar? {link_agendamento}',
     '{"sessions_left": 1, "days_before_expiry": 7}')
  on conflict (salon_id, kind) do nothing
$$;

create or replace function public.on_salon_created_automations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.seed_automations(new.id);
  return null;
end $$;
create trigger trg_salon_automations after insert on public.salons
  for each row execute function public.on_salon_created_automations();

select public.seed_automations(id) from public.salons;

-- ---------------------------------------------------------------------
-- Campanhas, fila e conversas
-- ---------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  body text not null check (length(trim(body)) between 5 and 1000),
  audience text not null default 'manual',
  scheduled_for timestamptz not null default now(),
  recipients_count int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index campaigns_salon_idx on public.campaigns(salon_id, created_at desc);

create table public.message_queue (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  campaign_id uuid references public.campaigns(id) on delete set null,
  phone text not null,
  body text not null,
  kind text not null check (kind in (
    'confirmacao_agendamento', 'lembrete_24h', 'confirmacao_2h', 'reagendamento', 'cancelamento',
    'pos_atendimento', 'avaliacao_google', 'retoque', 'recuperacao_falta', 'aniversario',
    'reativacao', 'pacote_acabando', 'campanha', 'manual', 'resposta', 'teste')),
  status text not null default 'pendente' check (status in (
    'pendente', 'enviando', 'enviada', 'falhou', 'cancelada', 'ignorada', 'expirada')),
  scheduled_for timestamptz not null default now(),
  expires_at timestamptz,
  attempts int not null default 0,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  last_error text,
  dedupe_key text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index message_queue_dedupe_uniq on public.message_queue(salon_id, dedupe_key) where dedupe_key is not null;
create index message_queue_pending_idx on public.message_queue(salon_id, scheduled_for) where status = 'pendente';
create index message_queue_salon_idx on public.message_queue(salon_id, created_at desc);
create index message_queue_phone_idx on public.message_queue(salon_id, public.phone_key(phone), sent_at desc);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  phone text not null,
  client_id uuid references public.clients(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  body text not null,
  queue_id uuid references public.message_queue(id) on delete set null,
  provider_message_id text,
  sender_name text,
  created_at timestamptz not null default now()
);
create unique index whatsapp_messages_provider_uniq on public.whatsapp_messages(salon_id, provider_message_id)
  where provider_message_id is not null;
create index whatsapp_messages_phone_idx on public.whatsapp_messages(salon_id, public.phone_key(phone), created_at desc);

create table public.client_feedback (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  score int not null check (score between 0 and 10),
  comment text,
  created_at timestamptz not null default now(),
  unique (appointment_id)
);
create index client_feedback_salon_idx on public.client_feedback(salon_id, created_at desc);

-- ---------------------------------------------------------------------
-- Texto das mensagens
-- ---------------------------------------------------------------------
create or replace function public.render_message(p_template text, p_vars jsonb)
returns text language plpgsql immutable as $$
declare
  k text;
  v text;
  r text := p_template;
begin
  for k, v in select key, value from jsonb_each_text(coalesce(p_vars, '{}')) loop
    r := replace(r, '{' || k || '}', coalesce(v, ''));
  end loop;
  return trim(regexp_replace(r, '[ \t]{2,}', ' ', 'g'));
end $$;

create or replace function public.booking_link(p_salon_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(app_url, ''), '') || '/agendar/' || slug from public.salons where id = p_salon_id
$$;

create or replace function public.weekday_pt(p_date date)
returns text language sql immutable as $$
  select (array['segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado', 'domingo'])
         [extract(isodow from p_date)::int]
$$;

create or replace function public.first_name(p_name text)
returns text language sql immutable as $$
  select split_part(trim(coalesce(p_name, '')), ' ', 1)
$$;

create or replace function public.client_message_vars(p_client_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'nome', public.first_name(c.name),
    'nome_completo', c.name,
    'salao', s.name,
    'link_agendamento', public.booking_link(s.id),
    'link_avaliacao', coalesce(s.google_review_url, '')
  )
  from public.clients c join public.salons s on s.id = c.salon_id
  where c.id = p_client_id
$$;

create or replace function public.appointment_message_vars(p_appointment_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.client_message_vars(a.client_id) || jsonb_build_object(
    'servico', (select string_agg(sv.name, ' + ' order by i.position)
                from public.appointment_items i join public.services sv on sv.id = i.service_id
                where i.appointment_id = a.id),
    'profissional', (select string_agg(p.name, ' e ' order by p.first_pos)
                     from (select pr.name, min(i.position) as first_pos
                           from public.appointment_items i join public.professionals pr on pr.id = i.professional_id
                           where i.appointment_id = a.id group by pr.name) p),
    'data', public.weekday_pt((a.starts_at at time zone s.timezone)::date) || ', '
            || to_char(a.starts_at at time zone s.timezone, 'DD/MM'),
    'hora', to_char(a.starts_at at time zone s.timezone, 'HH24:MI')
  )
  from public.appointments a join public.salons s on s.id = a.salon_id
  where a.id = p_appointment_id
$$;

-- Enfileira uma automação para um cliente. Devolve null se a automação está
-- desligada, o cliente não tem telefone, pediu opt-out ou a mensagem já existe.
create or replace function public.enqueue_automation(
  p_salon_id uuid, p_kind public.automation_kind, p_client_id uuid, p_vars jsonb,
  p_scheduled_for timestamptz, p_expires_at timestamptz, p_dedupe text, p_appointment_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  au public.automations;
  c public.clients;
  v_id uuid;
begin
  select * into au from public.automations where salon_id = p_salon_id and kind = p_kind and enabled;
  if not found then
    return null;
  end if;
  select * into c from public.clients where id = p_client_id and salon_id = p_salon_id;
  if not found or c.phone is null or c.archived_at is not null or c.opt_out
     or public.is_opted_out(p_salon_id, c.phone) then
    return null;
  end if;
  insert into public.message_queue (salon_id, client_id, appointment_id, phone, body, kind,
                                    scheduled_for, expires_at, dedupe_key, lead_id)
  values (p_salon_id, c.id, p_appointment_id, c.phone,
          public.render_message(au.template, p_vars || jsonb_build_object('cupom', coalesce(au.settings ->> 'coupon', ''))),
          p_kind::text, p_scheduled_for, p_expires_at, p_dedupe,
          (select id from public.leads where salon_id = p_salon_id and client_id = c.id and archived_at is null))
  on conflict (salon_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Mensagens que nascem de eventos da agenda. Trigger adiado: quando roda,
-- os itens (serviços e profissionais) do agendamento já existem.
create or replace function public.on_appointment_messages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('agendado', 'confirmado') and new.starts_at > now() then
      if new.rescheduled_from_id is not null then
        perform public.enqueue_automation(new.salon_id, 'reagendamento', new.client_id,
          public.appointment_message_vars(new.id), now(), new.starts_at, 'reagendamento:' || new.id, new.id);
      else
        perform public.enqueue_automation(new.salon_id, 'confirmacao_agendamento', new.client_id,
          public.appointment_message_vars(new.id), now(), least(new.starts_at, now() + interval '1 day'),
          'confirmacao:' || new.id, new.id);
      end if;
    end if;
  elsif new.status is distinct from old.status then
    if new.status in ('cancelado', 'reagendado', 'concluido', 'nao_compareceu', 'em_atendimento') then
      update public.message_queue set status = 'cancelada', last_error = 'Agendamento ' || new.status::text
       where appointment_id = new.id and status = 'pendente'
         and kind in ('confirmacao_agendamento', 'lembrete_24h', 'confirmacao_2h', 'reagendamento');
    end if;
    if new.status = 'cancelado' and new.starts_at > now() then
      perform public.enqueue_automation(new.salon_id, 'cancelamento', new.client_id,
        public.appointment_message_vars(new.id), now(), now() + interval '1 day', 'cancelamento:' || new.id, new.id);
    end if;
  end if;
  return null;
end $$;
create constraint trigger trg_appointment_messages after insert or update of status on public.appointments
  deferrable initially deferred
  for each row execute function public.on_appointment_messages();

-- ---------------------------------------------------------------------
-- Mensagem manual, campanha, reenvio e cancelamento (recepção e admin)
-- ---------------------------------------------------------------------
create or replace function public.send_whatsapp_message(
  p_salon_id uuid, p_phone text, p_body text, p_client_id uuid default null, p_lead_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_phone text := public.normalize_phone(p_phone);
  v_id uuid;
begin
  if not public.is_salon_staff(p_salon_id) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if v_phone is null or length(v_phone) < 12 then
    raise exception 'Telefone inválido';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then
    raise exception 'Escreva a mensagem';
  end if;
  if public.is_opted_out(p_salon_id, v_phone) then
    raise exception 'OPT_OUT: este número pediu para não receber mensagens';
  end if;
  if p_client_id is not null and not public.row_in_salon('clients', p_client_id, p_salon_id)
     or p_lead_id is not null and not public.row_in_salon('leads', p_lead_id, p_salon_id) then
    raise exception 'Referência de outro salão';
  end if;
  insert into public.message_queue (salon_id, client_id, lead_id, phone, body, kind, expires_at, created_by)
  values (p_salon_id, p_client_id, p_lead_id, v_phone, trim(p_body), 'manual', now() + interval '2 days', auth.uid())
  returning id into v_id;
  -- Primeiro contato tira o lead de "Novo lead"
  if p_lead_id is not null then
    perform public.lead_auto_move(p_lead_id, 'em_contato')
      from public.leads where id = p_lead_id and stage = 'novo';
  end if;
  return v_id;
end $$;

create or replace function public.create_campaign(
  p_salon_id uuid, p_name text, p_body text, p_client_ids uuid[],
  p_audience text default 'manual', p_scheduled_for timestamptz default now()
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_count int;
begin
  if not public.is_salon_staff(p_salon_id) then
    raise exception 'Sem permissão' using errcode = '42501';
  end if;
  if coalesce(array_length(p_client_ids, 1), 0) = 0 then
    raise exception 'Escolha pelo menos um cliente';
  end if;
  if array_length(p_client_ids, 1) > 1000 then
    raise exception 'Uma campanha vai para no máximo 1000 clientes';
  end if;
  insert into public.campaigns (salon_id, name, body, audience, scheduled_for, created_by)
  values (p_salon_id, trim(p_name), trim(p_body), coalesce(p_audience, 'manual'), coalesce(p_scheduled_for, now()), auth.uid())
  returning id into v_id;

  insert into public.message_queue (salon_id, client_id, campaign_id, phone, body, kind,
                                    scheduled_for, expires_at, dedupe_key, created_by, lead_id)
  select p_salon_id, c.id, v_id, c.phone,
         public.render_message(trim(p_body), public.client_message_vars(c.id)),
         'campanha', coalesce(p_scheduled_for, now()), coalesce(p_scheduled_for, now()) + interval '3 days',
         'campanha:' || v_id || ':' || c.id, auth.uid(),
         (select l.id from public.leads l where l.salon_id = p_salon_id and l.client_id = c.id and l.archived_at is null)
  from public.clients c
  where c.salon_id = p_salon_id and c.id = any(p_client_ids)
    and c.phone is not null and c.archived_at is null and not c.opt_out
    and not public.is_opted_out(p_salon_id, c.phone);
  get diagnostics v_count = row_count;
  update public.campaigns set recipients_count = v_count where id = v_id;
  return v_id;
end $$;

-- Públicos prontos para campanha (o "Criar campanha" da Inteligência usa os mesmos)
create or replace function public.campaign_audience(p_salon_id uuid, p_audience text, p_days int default 60)
returns table (client_id uuid, name text, phone text, last_visit_at timestamptz, total_spent numeric)
language sql stable security invoker set search_path = public as $$
  select co.id, co.name, co.phone, co.last_visit_at, co.total_spent
  from public.client_overview co
  where co.salon_id = p_salon_id and co.archived_at is null and co.phone is not null and not co.opt_out
    and case p_audience
      when 'reativar' then co.last_visit_at < now() - make_interval(days => coalesce(p_days, 60))
                           and co.next_appointment_at is null and co.lost_at is null
      when 'retoque' then co.next_return_at <= now() and co.next_appointment_at is null
      when 'aniversariantes' then extract(month from co.birth_date) = extract(month from now() at time zone 'America/Sao_Paulo')
      when 'ativos' then co.lifecycle_status in ('ativo', 'agendado')
      when 'todos' then true
      else false
    end
  order by co.total_spent desc nulls last, co.name
  limit 1000
$$;

create or replace function public.cancel_queued_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_salon uuid;
begin
  select salon_id into v_salon from public.message_queue where id = p_id;
  if v_salon is null or not public.is_salon_staff(v_salon) then
    raise exception 'Mensagem não encontrada' using errcode = '42501';
  end if;
  update public.message_queue set status = 'cancelada', last_error = 'Cancelada pela equipe'
   where id = p_id and status = 'pendente';
end $$;

create or replace function public.retry_queued_message(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.message_queue;
begin
  select * into m from public.message_queue where id = p_id;
  if not found or not public.is_salon_staff(m.salon_id) then
    raise exception 'Mensagem não encontrada' using errcode = '42501';
  end if;
  if m.status not in ('falhou', 'expirada') then
    raise exception 'Só dá para reenviar mensagens que falharam ou expiraram';
  end if;
  if public.is_opted_out(m.salon_id, m.phone) then
    raise exception 'OPT_OUT: este número pediu para não receber mensagens';
  end if;
  update public.message_queue
     set status = 'pendente', attempts = 0, last_error = null, scheduled_for = now(),
         expires_at = now() + interval '1 day', claimed_at = null
   where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Recebimento (webhook). Só a Edge Function chama, com a service role.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_inbound(
  p_salon_id uuid, p_secret text, p_instance_id text, p_message_id text,
  p_phone text, p_sender_name text, p_body text, p_from_me boolean default false,
  p_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  w public.whatsapp_integrations;
  sl public.salons;
  v_phone text := public.normalize_phone(p_phone);
  v_body text := left(coalesce(p_body, ''), 4000);
  v_norm text;
  v_client public.clients;
  v_lead public.leads;
  v_q public.message_queue;
  v_score int;
  v_action text := 'registrada';
  v_min_score int;
begin
  select * into w from public.whatsapp_integrations where salon_id = p_salon_id;
  if not found or p_secret is null or w.webhook_secret <> p_secret then
    raise exception 'SEGREDO_INVALIDO' using errcode = '42501';
  end if;
  if w.instance_id is null or w.instance_id <> coalesce(p_instance_id, '') then
    raise exception 'INSTANCIA_INVALIDA' using errcode = '42501';
  end if;
  if v_phone is null then
    return jsonb_build_object('action', 'ignorada');
  end if;
  if p_message_id is not null and exists (
    select 1 from public.whatsapp_messages where salon_id = p_salon_id and provider_message_id = p_message_id
  ) then
    return jsonb_build_object('action', 'duplicada');
  end if;
  select * into sl from public.salons where id = p_salon_id;

  select * into v_client from public.clients
   where salon_id = p_salon_id and archived_at is null and public.phone_key(phone) = public.phone_key(v_phone)
   order by created_at limit 1;
  select * into v_lead from public.leads
   where salon_id = p_salon_id and archived_at is null
     and (public.phone_key(phone) = public.phone_key(v_phone) or (v_client.id is not null and client_id = v_client.id))
   order by created_at limit 1;

  insert into public.whatsapp_messages (salon_id, direction, phone, client_id, lead_id, body, provider_message_id, sender_name, created_at)
  values (p_salon_id, case when p_from_me then 'out' else 'in' end, v_phone, v_client.id, v_lead.id, v_body,
          p_message_id, nullif(trim(p_sender_name), ''), p_at);

  if p_from_me then
    -- mensagem digitada no celular do salão: só atualiza o card
    update public.leads set last_message = left(v_body, 300), last_message_at = p_at, last_message_direction = 'out'
     where id = v_lead.id;
    return jsonb_build_object('action', 'enviada_pelo_celular');
  end if;

  v_norm := trim(regexp_replace(upper(translate(v_body,
              'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
              'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')), '[^A-Z0-9 ]', '', 'g'));
  v_norm := regexp_replace(v_norm, '\s+', ' ', 'g');

  -- 1. Opt-out por palavra-chave
  if v_norm in ('SAIR', 'PARAR', 'STOP') then
    insert into public.opt_outs (salon_id, phone, reason, source_message)
    values (p_salon_id, v_phone, 'palavra_chave', left(v_body, 200))
    on conflict do nothing;
    insert into public.message_queue (salon_id, client_id, lead_id, phone, body, kind, expires_at, dedupe_key)
    values (p_salon_id, v_client.id, v_lead.id, v_phone,
            'Pronto, você não vai mais receber mensagens automáticas do ' || sl.name || '. Se mudar de ideia, é só falar com a gente.',
            'resposta', now() + interval '1 day', 'optout:' || public.phone_key(v_phone) || ':' || to_char(now(), 'YYYYMMDD'))
    on conflict (salon_id, dedupe_key) where dedupe_key is not null do nothing;
    v_action := 'opt_out';

  -- 2. SIM / NÃO em resposta a confirmação ou lembrete
  elsif v_norm ~ '^(SIM|S|CONFIRM[A-Z]*|OK)( |$)' or v_norm ~ '^(NAO|N)( |$)' then
    select q.* into v_q from public.message_queue q
     join public.appointments a on a.id = q.appointment_id
     where q.salon_id = p_salon_id and q.status = 'enviada'
       and q.kind in ('confirmacao_agendamento', 'lembrete_24h', 'confirmacao_2h', 'reagendamento')
       and q.sent_at > now() - interval '4 days'
       and public.phone_key(q.phone) = public.phone_key(v_phone)
       and a.status in ('agendado', 'confirmado') and a.starts_at > now() - interval '1 hour'
     order by q.sent_at desc limit 1;
    if v_q.id is not null then
      if v_norm ~ '^(NAO|N)( |$)' then
        update public.appointments set reschedule_requested_at = now() where id = v_q.appointment_id;
        perform public.notify(p_salon_id, 'remarcar',
          coalesce(v_client.name, v_phone) || ' pediu para remarcar',
          'Respondeu NÃO à mensagem de ' || coalesce(public.appointment_message_vars(v_q.appointment_id) ->> 'data', '') ||
          ' às ' || coalesce(public.appointment_message_vars(v_q.appointment_id) ->> 'hora', '') || '. Ofereça outro horário.',
          '/agenda?agendamento=' || v_q.appointment_id);
        insert into public.message_queue (salon_id, client_id, lead_id, phone, body, kind, expires_at, dedupe_key, appointment_id)
        values (p_salon_id, v_client.id, v_lead.id, v_phone,
                'Sem problema! A recepção vai te chamar para combinar outro horário. Se preferir, escolha aqui: ' || public.booking_link(p_salon_id),
                'resposta', now() + interval '1 day', 'nao:' || v_q.appointment_id, v_q.appointment_id)
        on conflict (salon_id, dedupe_key) where dedupe_key is not null do nothing;
        if v_lead.id is not null then
          perform public.lead_auto_move(v_lead.id, 'follow_up');
        end if;
        v_action := 'pediu_remarcar';
      else
        update public.appointments set status = 'confirmado', reschedule_requested_at = null
         where id = v_q.appointment_id and status = 'agendado';
        v_action := 'confirmado';
      end if;
    end if;

  -- 3. Nota de 0 a 10 depois do atendimento
  elsif v_norm ~ '^([0-9]|10)$' then
    v_score := v_norm::int;
    select q.* into v_q from public.message_queue q
     where q.salon_id = p_salon_id and q.status = 'enviada' and q.kind = 'pos_atendimento'
       and q.sent_at > now() - interval '7 days'
       and public.phone_key(q.phone) = public.phone_key(v_phone)
       and not exists (select 1 from public.client_feedback f where f.appointment_id = q.appointment_id)
     order by q.sent_at desc limit 1;
    if v_q.id is not null then
      insert into public.client_feedback (salon_id, client_id, appointment_id, score)
      values (p_salon_id, v_q.client_id, v_q.appointment_id, v_score)
      on conflict (appointment_id) do nothing;
      select coalesce((settings ->> 'min_score')::int, 9) into v_min_score
        from public.automations where salon_id = p_salon_id and kind = 'avaliacao_google';
      if v_score >= coalesce(v_min_score, 9) and nullif(sl.google_review_url, '') is not null and v_q.client_id is not null then
        perform public.enqueue_automation(p_salon_id, 'avaliacao_google', v_q.client_id,
          public.client_message_vars(v_q.client_id), now(), now() + interval '2 days',
          'avaliacao:' || v_q.appointment_id, v_q.appointment_id);
      elsif v_score <= 6 then
        perform public.notify(p_salon_id, 'nota_baixa',
          'Nota ' || v_score || ' de ' || coalesce(v_client.name, v_phone),
          'Vale ligar para entender o que aconteceu no atendimento.',
          case when v_client.id is not null then '/clientes/' || v_client.id end,
          '{admin}');
      end if;
      v_action := 'nota';
    end if;
  end if;

  -- 4. CRM: desconhecido vira lead; conhecido atualiza o card
  if v_lead.id is null and v_client.id is null and v_action <> 'opt_out' then
    insert into public.leads (salon_id, name, phone, origin, stage, last_message, last_message_at, last_message_direction)
    values (p_salon_id, coalesce(nullif(trim(p_sender_name), ''), v_phone), v_phone, 'whatsapp', 'novo',
            left(v_body, 300), p_at, 'in')
    returning * into v_lead;
    update public.whatsapp_messages set lead_id = v_lead.id
     where salon_id = p_salon_id and lead_id is null and public.phone_key(phone) = public.phone_key(v_phone);
    perform public.notify(p_salon_id, 'novo_lead', 'Novo lead no WhatsApp: ' || v_lead.name, left(v_body, 140), '/crm?lead=' || v_lead.id);
    if v_action = 'registrada' then v_action := 'novo_lead'; end if;
  elsif v_lead.id is not null then
    update public.leads set last_message = left(v_body, 300), last_message_at = p_at, last_message_direction = 'in'
     where id = v_lead.id;
    if v_lead.stage in ('base_fria', 'perdido') and v_action = 'registrada' then
      perform public.lead_auto_move(v_lead.id, 'em_contato');
    end if;
  end if;

  return jsonb_build_object('action', v_action, 'lead_id', v_lead.id, 'client_id', v_client.id);
end $$;

-- ---------------------------------------------------------------------
-- Envio: lote para a Edge Function e retorno do resultado
-- ---------------------------------------------------------------------
create or replace function public.claim_whatsapp_messages(p_now timestamptz default now(), p_max_per_salon int default 10)
returns table (
  id uuid, salon_id uuid, phone text, body text,
  instance_id text, token text, client_token text, delay_seconds int
) language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  s record;
  q record;
  v_local timestamp;
  v_sent int;
  v_last timestamptz;
  v_allowed int;
  v_wait int;
  i int;
begin
  -- devolve à fila o que travou em "enviando" (função caiu no meio)
  update public.message_queue m
     set status = case when m.attempts >= 3 then 'falhou' else 'pendente' end,
         last_error = coalesce(m.last_error, 'Envio interrompido')
   where m.status = 'enviando' and m.claimed_at < p_now - interval '10 minutes';
  update public.message_queue m set status = 'expirada'
   where m.status = 'pendente' and m.expires_at < p_now;

  for s in
    select sl.id as sid, sl.timezone, sl.wa_window_start, sl.wa_window_end, sl.wa_daily_limit, sl.wa_spacing_seconds,
           w.instance_id as wi, w.token as wt, w.client_token as wc
    from public.salons sl
    join public.whatsapp_integrations w on w.salon_id = sl.id
    where w.active and w.instance_id is not null and w.token is not null and sl.suspended_at is null
  loop
    v_local := p_now at time zone s.timezone;
    if v_local::time < s.wa_window_start or v_local::time >= s.wa_window_end then
      continue;
    end if;
    select count(*) into v_sent from public.message_queue m
     where m.salon_id = s.sid and m.status in ('enviada', 'enviando')
       and m.claimed_at >= (date_trunc('day', v_local) at time zone s.timezone);
    select max(m.sent_at) into v_last from public.message_queue m
     where m.salon_id = s.sid and m.status = 'enviada' and m.sent_at > p_now - interval '1 day';
    v_allowed := least(s.wa_daily_limit - v_sent, p_max_per_salon, greatest(1, 60 / s.wa_spacing_seconds));
    if v_allowed <= 0 then
      continue;
    end if;
    v_wait := greatest(0, ceil(extract(epoch from (coalesce(v_last, p_now - interval '1 day')
                                                   + make_interval(secs => s.wa_spacing_seconds) - p_now))))::int;
    i := 0;
    for q in
      select m.id as qid, m.phone as qphone, m.body as qbody, m.kind as qkind, m.client_id as qclient
      from public.message_queue m
      where m.salon_id = s.sid and m.status = 'pendente' and m.scheduled_for <= p_now
      order by m.scheduled_for, m.created_at
      limit v_allowed + 200
      for update skip locked
    loop
      if q.qkind <> 'resposta' and public.is_opted_out(s.sid, q.qphone) then
        update public.message_queue set status = 'ignorada', last_error = 'Pediu para sair (opt-out)' where id = q.qid;
        continue;
      end if;
      if q.qclient is not null and exists (select 1 from public.clients c where c.id = q.qclient and c.is_demo) then
        update public.message_queue set status = 'ignorada', last_error = 'Cliente de demonstração' where id = q.qid;
        continue;
      end if;
      exit when i >= v_allowed;
      update public.message_queue set status = 'enviando', attempts = attempts + 1, claimed_at = p_now where id = q.qid;
      id := q.qid; salon_id := s.sid; phone := q.qphone; body := q.qbody;
      instance_id := s.wi; token := s.wt; client_token := s.wc;
      delay_seconds := v_wait + i * s.wa_spacing_seconds;
      return next;
      i := i + 1;
    end loop;
  end loop;
end $$;

-- p_final: erro que não adianta repetir (número inválido, token errado)
create or replace function public.report_whatsapp_result(
  p_id uuid, p_ok boolean, p_provider_message_id text default null, p_error text default null,
  p_final boolean default false
) returns void language plpgsql security definer set search_path = public as $$
declare
  m public.message_queue;
begin
  select * into m from public.message_queue where id = p_id for update;
  if not found or m.status <> 'enviando' then
    return;
  end if;
  if p_ok then
    update public.message_queue
       set status = 'enviada', sent_at = now(), provider_message_id = p_provider_message_id, last_error = null
     where id = p_id;
    insert into public.whatsapp_messages (salon_id, direction, phone, client_id, lead_id, body, queue_id, provider_message_id)
    values (m.salon_id, 'out', m.phone, m.client_id, m.lead_id, m.body, m.id, p_provider_message_id)
    on conflict do nothing;
    update public.leads set last_message = left(m.body, 300), last_message_at = now(), last_message_direction = 'out'
     where id = m.lead_id;
  else
    update public.message_queue
       set status = case when m.attempts >= 3 or p_final then 'falhou' else 'pendente' end,
           scheduled_for = now() + make_interval(mins => 5 * m.attempts),
           last_error = left(coalesce(p_error, 'Falha no envio'), 500)
     where id = p_id;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Rotina das automações por tempo (pg_cron a cada 5 minutos)
-- ---------------------------------------------------------------------
create or replace function public.run_automations(p_now timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
  v_id uuid;
begin
  update public.message_queue set status = 'expirada'
   where status = 'pendente' and expires_at < p_now;

  -- Lembrete 24h e confirmação 2h antes
  for r in
    select a.id, a.salon_id, a.client_id, a.starts_at, au.kind
    from public.automations au
    join public.salons sl on sl.id = au.salon_id and sl.suspended_at is null
    join public.appointments a on a.salon_id = au.salon_id
    where au.enabled and au.kind in ('lembrete_24h', 'confirmacao_2h')
      and a.status in ('agendado', 'confirmado')
      and (au.kind = 'lembrete_24h' or a.status = 'agendado')
      and a.starts_at > p_now
      and a.starts_at <= p_now + make_interval(hours => coalesce((au.settings ->> 'hours_before')::int, 24))
      and a.created_at <= a.starts_at - make_interval(hours => coalesce((au.settings ->> 'hours_before')::int, 24))
  loop
    v_id := public.enqueue_automation(r.salon_id, r.kind, r.client_id, public.appointment_message_vars(r.id),
                                      p_now, r.starts_at, r.kind::text || ':' || r.id, r.id);
    n := n + (v_id is not null)::int;
  end loop;

  -- Pós-atendimento: no dia seguinte, a partir do horário escolhido
  for r in
    select distinct on (a.client_id) a.id, a.salon_id, a.client_id,
           (a.starts_at at time zone sl.timezone)::date as day, sl.timezone
    from public.automations au
    join public.salons sl on sl.id = au.salon_id and sl.suspended_at is null
    join public.appointments a on a.salon_id = au.salon_id
    where au.enabled and au.kind = 'pos_atendimento' and a.status = 'concluido'
      and (a.starts_at at time zone sl.timezone)::date = (p_now at time zone sl.timezone)::date - 1
      and (p_now at time zone sl.timezone)::time >= coalesce((au.settings ->> 'hour')::time, '10:00')
    order by a.client_id, a.starts_at desc
  loop
    v_id := public.enqueue_automation(r.salon_id, 'pos_atendimento', r.client_id, public.appointment_message_vars(r.id),
                                      p_now, ((r.day + 2)::timestamp at time zone r.timezone),
                                      'pos:' || r.client_id || ':' || r.day, r.id);
    n := n + (v_id is not null)::int;
  end loop;

  -- Recuperação de falta (não envia se já remarcou)
  for r in
    select a.id, a.salon_id, a.client_id
    from public.automations au
    join public.salons sl on sl.id = au.salon_id and sl.suspended_at is null
    join public.appointments a on a.salon_id = au.salon_id
    where au.enabled and au.kind = 'recuperacao_falta' and a.status = 'nao_compareceu'
      and a.no_show_at <= p_now - make_interval(hours => coalesce((au.settings ->> 'hours_after')::int, 2))
      and a.no_show_at > p_now - interval '1 day'
      and not exists (
        select 1 from public.appointments f
        where f.client_id = a.client_id and f.status in ('agendado', 'confirmado') and f.starts_at > p_now
      )
  loop
    v_id := public.enqueue_automation(r.salon_id, 'recuperacao_falta', r.client_id, public.appointment_message_vars(r.id),
                                      p_now, p_now + interval '12 hours', 'falta:' || r.id, r.id);
    n := n + (v_id is not null)::int;
  end loop;

  -- Aniversário
  for r in
    select c.id, c.salon_id, sl.timezone, (p_now at time zone sl.timezone)::date as today
    from public.automations au
    join public.salons sl on sl.id = au.salon_id and sl.suspended_at is null
    join public.clients c on c.salon_id = au.salon_id
    where au.enabled and au.kind = 'aniversario' and c.archived_at is null and c.birth_date is not null
      and to_char(c.birth_date, 'MM-DD') = to_char(p_now at time zone sl.timezone, 'MM-DD')
      and (p_now at time zone sl.timezone)::time >= coalesce((au.settings ->> 'hour')::time, '09:00')
  loop
    v_id := public.enqueue_automation(r.salon_id, 'aniversario', r.id, public.client_message_vars(r.id),
                                      p_now, ((r.today + 1)::timestamp at time zone r.timezone),
                                      'aniversario:' || r.id || ':' || extract(year from r.today), null);
    n := n + (v_id is not null)::int;
  end loop;

  -- Hora de retocar: passou do intervalo de retorno e não tem nada marcado
  for r in
    select co.id, co.salon_id, co.next_return_at,
           (select sv.name
              from public.appointments a
              join public.appointment_items i on i.appointment_id = a.id
              join public.services sv on sv.id = i.service_id
             where a.client_id = co.id and a.status = 'concluido' and sv.return_interval_days is not null
             order by a.starts_at desc, sv.return_interval_days limit 1) as service_name
    from public.automations au
    join public.salons sl on sl.id = au.salon_id and sl.suspended_at is null
    join public.client_overview co on co.salon_id = au.salon_id
    where au.enabled and au.kind = 'retoque' and co.archived_at is null and co.lost_at is null
      and co.next_appointment_at is null
      and co.next_return_at <= p_now
      and co.next_return_at > p_now - make_interval(days => coalesce((au.settings ->> 'window_days')::int, 7))
  loop
    v_id := public.enqueue_automation(r.salon_id, 'retoque', r.id,
                                      public.client_message_vars(r.id) || jsonb_build_object('servico', coalesce(r.service_name, 'seu serviço')),
                                      p_now, p_now + interval '2 days',
                                      'retoque:' || r.id || ':' || r.next_return_at::date, null);
    n := n + (v_id is not null)::int;
  end loop;

  -- Reativação: quem mais gastou primeiro, até X por dia, sem repetir antes do intervalo
  for r in
    select x.id, x.salon_id, x.today from (
      select co.id, co.salon_id, (p_now at time zone sl.timezone)::date as today,
             row_number() over (partition by co.salon_id order by co.total_spent desc nulls last, co.last_visit_at) as rn,
             coalesce((au.settings ->> 'daily_max')::int, 5) - (
               select count(*) from public.message_queue m
               where m.salon_id = co.salon_id and m.kind = 'reativacao'
                 and m.created_at >= (date_trunc('day', p_now at time zone sl.timezone) at time zone sl.timezone)
             ) as room
      from public.automations au
      join public.salons sl on sl.id = au.salon_id and sl.suspended_at is null
      join public.client_overview co on co.salon_id = au.salon_id
      where au.enabled and au.kind = 'reativacao' and co.archived_at is null and co.lost_at is null
        and co.phone is not null and not co.opt_out
        and co.last_visit_at < p_now - make_interval(days => coalesce((au.settings ->> 'days')::int, 60))
        and co.next_appointment_at is null
        and not exists (
          select 1 from public.message_queue m
          where m.client_id = co.id and m.kind = 'reativacao'
            and m.created_at > p_now - make_interval(days => coalesce((au.settings ->> 'repeat_after_days')::int, 60))
        )
    ) x
    where x.rn <= x.room
  loop
    v_id := public.enqueue_automation(r.salon_id, 'reativacao', r.id, public.client_message_vars(r.id),
                                      p_now, p_now + interval '1 day', 'reativacao:' || r.id || ':' || r.today, null);
    n := n + (v_id is not null)::int;
  end loop;

  -- Pacote perto de acabar ou de vencer
  for r in
    select p.client_package_id, p.salon_id, p.client_id, p.package_name, p.left_total, p.expires_at, sl.timezone,
           case when p.left_total <= coalesce((au.settings ->> 'sessions_left')::int, 1) then 'sessoes' else 'validade' end as reason
    from (
      select client_package_id, salon_id, client_id, package_name, expires_at, sum(sessions_left) as left_total
      from public.client_package_overview where usable
      group by client_package_id, salon_id, client_id, package_name, expires_at
    ) p
    join public.automations au on au.salon_id = p.salon_id and au.enabled and au.kind = 'pacote_acabando'
    join public.salons sl on sl.id = p.salon_id and sl.suspended_at is null
    where p.left_total <= coalesce((au.settings ->> 'sessions_left')::int, 1)
       or p.expires_at <= p_now + make_interval(days => coalesce((au.settings ->> 'days_before_expiry')::int, 7))
  loop
    v_id := public.enqueue_automation(r.salon_id, 'pacote_acabando', r.client_id,
      public.client_message_vars(r.client_id) || jsonb_build_object(
        'pacote', r.package_name,
        'detalhe_pacote', case when r.reason = 'sessoes'
          then case when r.left_total = 1 then 'resta 1 sessão' else 'restam ' || r.left_total || ' sessões' end
          else 'vence em ' || to_char(r.expires_at at time zone r.timezone, 'DD/MM') end),
      p_now, p_now + interval '2 days', 'pacote:' || r.client_package_id || ':' || r.reason, null);
    n := n + (v_id is not null)::int;
  end loop;

  -- Leads parados há 30 dias vão para a base fria
  for r in
    select l.id from public.leads l
    where l.archived_at is null and l.stage in ('novo', 'em_contato', 'follow_up')
      and greatest(coalesce(l.last_message_at, l.created_at), l.stage_changed_at) < p_now - interval '30 days'
      and (l.next_follow_up_at is null or l.next_follow_up_at < p_now - interval '30 days')
  loop
    perform public.lead_auto_move(r.id, 'base_fria');
  end loop;

  return n;
end $$;

-- pg_cron (Supabase): roda as automações a cada 5 minutos
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('salon-os-automations', '*/5 * * * *', 'select public.run_automations()');
  end if;
exception when others then
  raise notice 'pg_cron indisponível: agende public.run_automations() manualmente (%).', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
alter table public.leads enable row level security;
alter table public.lead_stage_history enable row level security;
alter table public.opt_outs enable row level security;
alter table public.automations enable row level security;
alter table public.campaigns enable row level security;
alter table public.message_queue enable row level security;
alter table public.whatsapp_messages enable row level security;
alter table public.client_feedback enable row level security;

create policy notifications_select on public.notifications for select to authenticated
  using (public.salon_role_of(salon_id) = any(roles));
create policy notification_reads_own on public.notification_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy leads_select on public.leads for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy leads_insert on public.leads for insert to authenticated
  with check (public.is_salon_staff(salon_id) and created_by = auth.uid());
create policy leads_update on public.leads for update to authenticated
  using (public.is_salon_staff(salon_id)) with check (public.is_salon_staff(salon_id));
-- sem delete: arquivar

create policy lead_history_select on public.lead_stage_history for select to authenticated
  using (public.is_salon_staff(salon_id));

create policy opt_outs_select on public.opt_outs for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy opt_outs_insert on public.opt_outs for insert to authenticated
  with check (public.is_salon_staff(salon_id) and reason = 'manual');
create policy opt_outs_delete on public.opt_outs for delete to authenticated
  using (public.is_salon_staff(salon_id));

create policy automations_select on public.automations for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy automations_update on public.automations for update to authenticated
  using (public.is_salon_admin(salon_id)) with check (public.is_salon_admin(salon_id));

create policy campaigns_select on public.campaigns for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy queue_select on public.message_queue for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy wa_messages_select on public.whatsapp_messages for select to authenticated
  using (public.is_salon_staff(salon_id));
create policy feedback_select on public.client_feedback for select to authenticated
  using (public.is_salon_staff(salon_id));

-- Escrita na fila, campanhas, conversas e notas só pelas funções
revoke insert, update, delete on public.message_queue, public.campaigns, public.whatsapp_messages,
  public.client_feedback, public.lead_stage_history, public.notifications from authenticated;
revoke insert, update, delete on public.automations from authenticated;
grant update (enabled, template, settings) on public.automations to authenticated;

do $$
declare f text;
begin
  -- Recepção e admin (cada função checa o papel)
  foreach f in array array[
    'whatsapp_integration_status(uuid)',
    'save_whatsapp_integration(uuid, text, text, text, text, text)',
    'set_whatsapp_active(uuid, boolean)',
    'rotate_whatsapp_webhook_secret(uuid)',
    'mark_notifications_read(uuid)',
    'convert_lead(uuid)',
    'send_whatsapp_message(uuid, text, text, uuid, uuid)',
    'create_campaign(uuid, text, text, uuid[], text, timestamptz)',
    'campaign_audience(uuid, text, int)',
    'cancel_queued_message(uuid)',
    'retry_queued_message(uuid)',
    'render_message(text, jsonb)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  -- Só servidor (Edge Functions com service role, pg_cron)
  foreach f in array array[
    'whatsapp_credentials(uuid)',
    'set_whatsapp_status(uuid, text, text)',
    'whatsapp_inbound(uuid, text, text, text, text, text, text, boolean, timestamptz)',
    'claim_whatsapp_messages(timestamptz, int)',
    'report_whatsapp_result(uuid, boolean, text, text, boolean)',
    'run_automations(timestamptz)',
    'notify(uuid, text, text, text, text, public.salon_role[])',
    'enqueue_automation(uuid, public.automation_kind, uuid, jsonb, timestamptz, timestamptz, text, uuid)',
    'lead_auto_move(uuid, public.lead_stage, text)',
    'seed_automations(uuid)',
    'client_message_vars(uuid)',
    'appointment_message_vars(uuid)',
    'booking_link(uuid)',
    'is_opted_out(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
