-- =====================================================================
-- Salon OS · 015 · Painel SaaS (super admin)
-- Planos com limites (profissionais ativos e mensagens por mês), suspensão
-- com motivo, criação de salão pelo suporte, mover usuários entre salões e
-- uso por salão. O super admin NUNCA vê valores financeiros dos salões:
-- todas as funções do painel devolvem só contagens e datas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Planos
-- ---------------------------------------------------------------------
create table public.plans (
  id text primary key check (id ~ '^[a-z0-9_]+$'),
  name text not null check (length(trim(name)) > 0),
  -- nulo = sem limite
  max_professionals int check (max_professionals > 0),
  max_messages_month int check (max_messages_month > 0),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_plans_updated before update on public.plans
  for each row execute function public.set_updated_at();

insert into public.plans (id, name, max_professionals, max_messages_month, sort_order) values
  ('basico', 'Básico', 3, 1000, 1),
  ('pro', 'Pro', 15, 10000, 2);

alter table public.plans enable row level security;
create policy plans_select on public.plans for select to authenticated using (true);
revoke insert, update, delete on public.plans from anon, authenticated;

alter table public.salons
  add column plan_id text not null default 'basico' references public.plans(id),
  add column suspended_reason text check (length(suspended_reason) <= 500),
  add column suspended_by uuid references auth.users(id) on delete set null;

-- Plano e suspensão só mudam pelo painel (o admin do salão edita o resto da linha)
create or replace function public.guard_salon_platform_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_platform_admin()
     and (new.plan_id is distinct from old.plan_id
          or new.suspended_at is distinct from old.suspended_at
          or new.suspended_reason is distinct from old.suspended_reason
          or new.suspended_by is distinct from old.suspended_by) then
    raise exception 'Plano e suspensão só mudam pelo suporte da plataforma' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_guard_salon_platform_columns before update on public.salons
  for each row execute function public.guard_salon_platform_columns();

-- ---------------------------------------------------------------------
-- Histórico do painel (o audit_log é por salão; aqui ficam as ações da plataforma)
-- ---------------------------------------------------------------------
create table public.platform_audit (
  id bigint generated always as identity primary key,
  actor uuid references auth.users(id) on delete set null,
  action text not null,
  salon_id uuid references public.salons(id) on delete set null,
  target_user uuid references auth.users(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index platform_audit_created_idx on public.platform_audit(created_at desc);
alter table public.platform_audit enable row level security;
create policy platform_audit_select on public.platform_audit for select to authenticated
  using (public.is_platform_admin());
revoke insert, update, delete on public.platform_audit from anon, authenticated;

create or replace function public.platform_log(p_action text, p_salon_id uuid, p_target_user uuid, p_details jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.platform_audit (actor, action, salon_id, target_user, details)
  values (auth.uid(), p_action, p_salon_id, p_target_user, coalesce(p_details, '{}'::jsonb))
$$;

create or replace function public.assert_platform_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Só o super admin acessa o Painel SaaS' using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Uso e limites
-- ---------------------------------------------------------------------
-- Mensagens que saíram (ou estão saindo) no mês corrente, no fuso do salão. Teste de envio não conta.
create or replace function public.salon_month_messages(p_salon_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int
  from public.message_queue m
  join public.salons s on s.id = m.salon_id
  where m.salon_id = p_salon_id and m.status in ('enviada', 'enviando') and m.kind <> 'teste'
    and m.claimed_at >= (date_trunc('month', now() at time zone s.timezone) at time zone s.timezone)
$$;

-- Plano e consumo do salão (tela de Configurações do dono e painel)
create or replace function public.salon_plan_usage(p_salon_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_salon_admin(p_salon_id) or public.is_platform_admin()) then
    raise exception 'Sem acesso ao plano deste salão' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'plan_id', p.id, 'plan_name', p.name,
      'max_professionals', p.max_professionals,
      'professionals', (select count(*) from public.professionals pr where pr.salon_id = s.id and pr.active),
      'max_messages_month', p.max_messages_month,
      'messages_month', public.salon_month_messages(s.id))
    from public.salons s join public.plans p on p.id = s.plan_id
    where s.id = p_salon_id);
end $$;

-- Profissionais ativos: o plano define o teto. Os que já existem continuam se o plano baixar;
-- só não entra (ou volta a ficar ativo) mais ninguém acima do limite.
create or replace function public.guard_plan_professionals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_max int;
  v_plan text;
  v_count int;
begin
  if not new.active or (tg_op = 'UPDATE' and old.active) then
    return new;
  end if;
  select p.max_professionals, p.name into v_max, v_plan
  from public.salons s join public.plans p on p.id = s.plan_id where s.id = new.salon_id;
  if v_max is null then
    return new;
  end if;
  select count(*) into v_count from public.professionals
  where salon_id = new.salon_id and active and id <> new.id;
  if v_count >= v_max then
    raise exception 'LIMITE_PLANO: o plano % permite até % profissionais ativos. Inative alguém ou fale com o suporte para mudar de plano.', v_plan, v_max
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_guard_plan_professionals before insert or update of active on public.professionals
  for each row execute function public.guard_plan_professionals();

-- Fila do WhatsApp com o teto de mensagens do mês. O que passar do teto fica na fila
-- (e expira sozinho se tiver validade); o dono recebe um aviso por mês.
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
  v_month int;
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
           w.instance_id as wi, w.token as wt, w.client_token as wc,
           p.name as plan_name, p.max_messages_month as max_month
    from public.salons sl
    join public.plans p on p.id = sl.plan_id
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
    if s.max_month is not null then
      select count(*) into v_month from public.message_queue m
       where m.salon_id = s.sid and m.status in ('enviada', 'enviando') and m.kind <> 'teste'
         and m.claimed_at >= (date_trunc('month', v_local) at time zone s.timezone);
      if v_month >= s.max_month then
        if exists (select 1 from public.message_queue m
                   where m.salon_id = s.sid and m.status = 'pendente' and m.scheduled_for <= p_now)
           and not exists (select 1 from public.notifications n
                           where n.salon_id = s.sid and n.kind = 'limite_plano'
                             and n.created_at >= (date_trunc('month', v_local) at time zone s.timezone)) then
          perform public.notify(s.sid, 'limite_plano', 'Limite de mensagens do mês atingido',
            'O plano ' || s.plan_name || ' inclui ' || s.max_month || ' mensagens por mês. As próximas ficam na fila até o mês virar ou o plano mudar.',
            '/automacoes', '{admin}');
        end if;
        continue;
      end if;
      v_allowed := least(v_allowed, s.max_month - v_month);
    end if;
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

-- ---------------------------------------------------------------------
-- Painel: visão geral e salões (só contagens e datas, nada de R$)
-- ---------------------------------------------------------------------
create or replace function public.platform_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_platform_admin();
  return jsonb_build_object(
    'salons', (select count(*) from public.salons),
    'active', (select count(*) from public.salons where suspended_at is null),
    'suspended', (select count(*) from public.salons where suspended_at is not null),
    'new_30d', (select count(*) from public.salons where created_at >= now() - interval '30 days'),
    'users', (select count(distinct user_id) from public.salon_members where active),
    'by_plan', (select coalesce(jsonb_object_agg(p.id, (select count(*) from public.salons s where s.plan_id = p.id)), '{}'::jsonb)
                from public.plans p),
    'whatsapp_connected', (select count(*) from public.whatsapp_integrations where active and status = 'conectado'),
    'appointments_30d', (select count(*) from public.appointments where created_at >= now() - interval '30 days'));
end $$;

create or replace function public.platform_salons()
returns table (
  id uuid, name text, slug text, plan_id text, plan_name text, created_at timestamptz,
  suspended_at timestamptz, suspended_reason text, onboarding_completed boolean,
  owner_name text, owner_email text,
  team int, professionals int, max_professionals int, clients int,
  appointments_30d int, leads_30d int, messages_month int, max_messages_month int,
  whatsapp_status text, online_booking boolean,
  last_activity_at timestamptz, last_login_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_platform_admin();
  return query
  select s.id, s.name, s.slug, p.id, p.name, s.created_at,
         s.suspended_at, s.suspended_reason, s.onboarding_completed,
         own.full_name, own.email,
         (select count(*)::int from public.salon_members m where m.salon_id = s.id and m.active),
         (select count(*)::int from public.professionals pr where pr.salon_id = s.id and pr.active),
         p.max_professionals,
         (select count(*)::int from public.clients c where c.salon_id = s.id and c.archived_at is null),
         (select count(*)::int from public.appointments a where a.salon_id = s.id and a.created_at >= now() - interval '30 days'),
         (select count(*)::int from public.leads l where l.salon_id = s.id and l.created_at >= now() - interval '30 days'),
         public.salon_month_messages(s.id),
         p.max_messages_month,
         (select case when w.instance_id is null then null when not w.active then 'desligado' else w.status end
            from public.whatsapp_integrations w where w.salon_id = s.id),
         s.online_booking_enabled,
         -- dados de demonstração podem ter datas futuras: atividade nunca passa de agora
         least(now(), greatest(
           (select max(al.changed_at) from public.audit_log al where al.salon_id = s.id),
           (select max(a.created_at) from public.appointments a where a.salon_id = s.id),
           (select max(c.created_at) from public.clients c where c.salon_id = s.id),
           (select max(l.created_at) from public.leads l where l.salon_id = s.id))),
         (select max(u.last_sign_in_at) from public.salon_members m join auth.users u on u.id = m.user_id
           where m.salon_id = s.id and m.active)
  from public.salons s
  join public.plans p on p.id = s.plan_id
  left join lateral (
    select pf.full_name, pf.email from public.salon_members m join public.profiles pf on pf.id = m.user_id
    where m.salon_id = s.id and m.role = 'admin' and m.active
    order by m.created_at limit 1
  ) own on true
  order by s.created_at desc;
end $$;

create or replace function public.platform_salon_members(p_salon_id uuid)
returns table (member_id uuid, user_id uuid, full_name text, email text, role public.salon_role, active boolean,
               joined_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_platform_admin();
  return query
  select m.id, m.user_id, pf.full_name, coalesce(pf.email, u.email), m.role, m.active, m.created_at, u.last_sign_in_at
  from public.salon_members m
  join auth.users u on u.id = m.user_id
  left join public.profiles pf on pf.id = m.user_id
  where m.salon_id = p_salon_id
  order by m.active desc, m.role, pf.full_name;
end $$;

create or replace function public.platform_search_users(p_term text)
returns table (user_id uuid, full_name text, email text, last_sign_in_at timestamptz, memberships jsonb)
language plpgsql stable security definer set search_path = public as $$
declare
  v_term text := '%' || lower(trim(coalesce(p_term, ''))) || '%';
begin
  perform public.assert_platform_admin();
  if length(trim(coalesce(p_term, ''))) < 2 then
    return;
  end if;
  return query
  select u.id, pf.full_name, u.email::text, u.last_sign_in_at,
         coalesce((select jsonb_agg(jsonb_build_object('salon_id', s.id, 'salon_name', s.name, 'role', m.role, 'active', m.active)
                                    order by m.active desc, s.name)
                   from public.salon_members m join public.salons s on s.id = m.salon_id
                   where m.user_id = u.id), '[]'::jsonb)
  from auth.users u
  left join public.profiles pf on pf.id = u.id
  where lower(u.email) like v_term or lower(coalesce(pf.full_name, '')) like v_term
  order by pf.full_name nulls last, u.email
  limit 30;
end $$;

create or replace function public.platform_audit_list(p_limit int default 50)
returns table (id bigint, created_at timestamptz, action text, actor_name text, salon_name text, target_email text, details jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_platform_admin();
  return query
  select a.id, a.created_at, a.action, coalesce(pa.full_name, pa.email), s.name, tu.email::text, a.details
  from public.platform_audit a
  left join public.profiles pa on pa.id = a.actor
  left join public.salons s on s.id = a.salon_id
  left join auth.users tu on tu.id = a.target_user
  order by a.created_at desc
  limit least(greatest(p_limit, 1), 200);
end $$;

-- ---------------------------------------------------------------------
-- Painel: ações
-- ---------------------------------------------------------------------
-- Cria o salão. Dono já cadastrado vira admin na hora; senão sai um convite de admin
-- (o link volta para o painel copiar e mandar). O dono termina o onboarding no 1º acesso.
create or replace function public.platform_create_salon(p_name text, p_owner_email text, p_plan_id text default 'basico',
                                                        p_timezone text default 'America/Sao_Paulo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_email text := lower(trim(coalesce(p_owner_email, '')));
  v_user uuid;
  v_token uuid;
begin
  perform public.assert_platform_admin();
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Informe o nome do salão';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail do dono inválido';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Plano não encontrado';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'Fuso horário inválido';
  end if;

  insert into public.salons (name, slug, plan_id, timezone)
  values (trim(p_name), public.unique_salon_slug(p_name), p_plan_id, p_timezone)
  returning id into v_id;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    insert into public.salon_members (salon_id, user_id, role) values (v_id, v_user, 'admin');
    update public.profiles set current_salon_id = v_id where id = v_user and current_salon_id is null;
  else
    insert into public.invitations (salon_id, email, role, invited_by)
    values (v_id, v_email, 'admin', auth.uid())
    returning token into v_token;
  end if;

  perform public.platform_log('criar_salao', v_id, v_user,
    jsonb_build_object('nome', trim(p_name), 'dono', v_email, 'plano', p_plan_id, 'convite', v_token is not null));
  return jsonb_build_object('salon_id', v_id, 'owner_user_id', v_user, 'invitation_token', v_token);
end $$;

create or replace function public.platform_set_suspended(p_salon_id uuid, p_suspended boolean, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  s public.salons;
begin
  perform public.assert_platform_admin();
  select * into s from public.salons where id = p_salon_id for update;
  if not found then
    raise exception 'Salão não encontrado';
  end if;
  if p_suspended then
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Informe o motivo da suspensão';
    end if;
    if s.suspended_at is not null then
      return;
    end if;
    update public.salons set suspended_at = now(), suspended_reason = trim(p_reason), suspended_by = auth.uid()
     where id = p_salon_id;
  else
    if s.suspended_at is null then
      return;
    end if;
    update public.salons set suspended_at = null, suspended_reason = null, suspended_by = null where id = p_salon_id;
  end if;
  perform public.platform_log(case when p_suspended then 'suspender' else 'reativar' end, p_salon_id, null,
    jsonb_build_object('motivo', nullif(trim(coalesce(p_reason, '')), ''), 'suspenso_desde', s.suspended_at));
end $$;

create or replace function public.platform_set_plan(p_salon_id uuid, p_plan_id text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_old text;
begin
  perform public.assert_platform_admin();
  select plan_id into v_old from public.salons where id = p_salon_id for update;
  if not found then
    raise exception 'Salão não encontrado';
  end if;
  if not exists (select 1 from public.plans where id = p_plan_id) then
    raise exception 'Plano não encontrado';
  end if;
  if v_old = p_plan_id then
    return;
  end if;
  update public.salons set plan_id = p_plan_id where id = p_salon_id;
  perform public.platform_log('mudar_plano', p_salon_id, null, jsonb_build_object('de', v_old, 'para', p_plan_id));
end $$;

create or replace function public.platform_save_plan(p_id text, p_name text, p_max_professionals int, p_max_messages_month int)
returns void language plpgsql security definer set search_path = public as $$
declare
  old public.plans;
begin
  perform public.assert_platform_admin();
  select * into old from public.plans where id = p_id for update;
  if not found then
    raise exception 'Plano não encontrado';
  end if;
  update public.plans
     set name = trim(p_name), max_professionals = p_max_professionals, max_messages_month = p_max_messages_month
   where id = p_id;
  perform public.platform_log('editar_plano', null, null, jsonb_build_object(
    'plano', p_id,
    'antes', jsonb_build_object('nome', old.name, 'profissionais', old.max_professionals, 'mensagens', old.max_messages_month),
    'depois', jsonb_build_object('nome', trim(p_name), 'profissionais', p_max_professionals, 'mensagens', p_max_messages_month)));
end $$;

-- Move (ou adiciona, sem p_from) um usuário para outro salão com o papel escolhido.
-- O vínculo antigo fica inativo (histórico preservado) e o login de profissional do salão antigo é desligado.
create or replace function public.platform_move_user(p_user_id uuid, p_from_salon_id uuid, p_to_salon_id uuid, p_role public.salon_role)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_platform_admin();
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'Usuário não encontrado';
  end if;
  if not exists (select 1 from public.salons where id = p_to_salon_id) then
    raise exception 'Salão de destino não encontrado';
  end if;
  if p_from_salon_id = p_to_salon_id then
    raise exception 'Escolha um salão diferente do atual';
  end if;
  if p_from_salon_id is not null then
    if not exists (select 1 from public.salon_members where salon_id = p_from_salon_id and user_id = p_user_id and active) then
      raise exception 'O usuário não está ativo no salão de origem';
    end if;
    -- guard_last_admin impede deixar o salão de origem sem administrador
    update public.salon_members set active = false where salon_id = p_from_salon_id and user_id = p_user_id;
    update public.professionals set user_id = null where salon_id = p_from_salon_id and user_id = p_user_id;
  end if;

  insert into public.salon_members (salon_id, user_id, role, active)
  values (p_to_salon_id, p_user_id, p_role, true)
  on conflict (salon_id, user_id) do update set role = excluded.role, active = true;

  update public.profiles set current_salon_id = p_to_salon_id
   where id = p_user_id and (current_salon_id is null or current_salon_id = p_from_salon_id);

  perform public.platform_log(case when p_from_salon_id is null then 'adicionar_usuario' else 'mover_usuario' end,
    p_to_salon_id, p_user_id, jsonb_build_object('de', p_from_salon_id, 'para', p_to_salon_id, 'papel', p_role));
end $$;

-- Auditoria de quem entra e sai dos salões e das mudanças no cadastro do salão
create trigger trg_audit_salon_members after insert or update or delete on public.salon_members
  for each row execute function public.write_audit_log();

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'platform_overview()',
    'platform_salons()',
    'platform_salon_members(uuid)',
    'platform_search_users(text)',
    'platform_audit_list(int)',
    'platform_create_salon(text, text, text, text)',
    'platform_set_suspended(uuid, boolean, text)',
    'platform_set_plan(uuid, text)',
    'platform_save_plan(text, text, int, int)',
    'platform_move_user(uuid, uuid, uuid, public.salon_role)',
    'salon_plan_usage(uuid)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array[
    'platform_log(text, uuid, uuid, jsonb)',
    'salon_month_messages(uuid)',
    'assert_platform_admin()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
