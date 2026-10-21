-- Testes da Fase 1: multi-tenant, papéis, trava de agenda, remarcação, convites.
-- Cada bloco "as_user" simula um usuário logado (role authenticated + auth.uid()).

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

-- Usuários
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'dona@bela.com', '{"full_name":"Dona Bela"}'),
  ('00000000-0000-0000-0000-00000000000b', 'dono@outro.com', '{"full_name":"Outro Dono"}'),
  ('00000000-0000-0000-0000-00000000000c', 'recepcao@bela.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'ana@bela.com', '{}'),
  ('00000000-0000-0000-0000-00000000000e', 'intrusa@x.com', '{}');

select pg_temp.check((select count(*) from public.profiles) = 5, 'trigger cria perfil para cada usuário');

-- Dona A cria o salão e carrega a demonstração
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.create_salon('Studio Bela Flor') as sa \gset
select pg_temp.check((select slug from public.salons where id = :'sa') = 'studio-bela-flor', 'slug gerado sem acento');
select public.seed_demo_salon(:'sa');
select pg_temp.check((select count(*) from public.services where salon_id = :'sa') = 15, 'demo: 15 serviços');
select pg_temp.check((select count(*) from public.professionals where salon_id = :'sa') = 3, 'demo: 3 profissionais');
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa') = 30, 'demo: 30 clientes');
select pg_temp.check((select count(*) from public.appointments where salon_id = :'sa') > 150, 'demo: agendamentos de 6 semanas');
select pg_temp.expect_error(format('select public.seed_demo_salon(%L)', :'sa'), '%já tem clientes%');

-- Dono B cria outro salão e NÃO enxerga nada do salão A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select public.create_salon('Barbearia do Zé') as sb \gset
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa') = 0, 'B não lê clientes de A');
select pg_temp.check((select count(*) from public.services where salon_id = :'sa') = 0, 'B não lê serviços de A');
select pg_temp.check((select count(*) from public.appointments where salon_id = :'sa') = 0, 'B não lê agenda de A');
select pg_temp.check((select count(*) from public.salons) = 1, 'B só vê o próprio salão');
update public.salons set name = 'hackeado' where id = :'sa';
select pg_temp.expect_error(format(
  $q$insert into public.clients (salon_id, name) values (%L, 'x')$q$, :'sa'), '%row-level security%');
select pg_temp.expect_error(format('select public.switch_salon(%L)', :'sa'), '%não faz parte%');

-- Convites
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select name from public.salons where id = :'sa') = 'Studio Bela Flor', 'update de B não teve efeito');
insert into public.invitations (salon_id, email, role, invited_by)
  values (:'sa', 'recepcao@bela.com', 'recepcao', auth.uid()) returning token as tok_r \gset
insert into public.invitations (salon_id, email, role, invited_by)
  values (:'sa', 'ana@bela.com', 'profissional', auth.uid()) returning token as tok_p \gset
insert into public.invitations (salon_id, email, role, invited_by, expires_at)
  values (:'sa', 'intrusa@x.com', 'admin', auth.uid(), now() - interval '1 day') returning token as tok_old \gset

select pg_temp.as_user('00000000-0000-0000-0000-00000000000e');
select pg_temp.expect_error(format('select public.accept_invitation(%L)', :'tok_r'), '%outro e-mail%');
select pg_temp.expect_error(format('select public.accept_invitation(%L)', :'tok_old'), '%expirou%');
select pg_temp.check((select count(*) from public.invitations) = 0, 'não-admin não lê convites');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.accept_invitation(:'tok_r');
select pg_temp.check(public.salon_role_of(:'sa') = 'recepcao', 'recepção entrou no salão pelo convite');
select pg_temp.expect_error(format('select public.accept_invitation(%L)', :'tok_r'), '%já foi usado%');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select public.accept_invitation(:'tok_p');

-- Admin liga a usuária Ana à profissional Ana
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.professionals set user_id = '00000000-0000-0000-0000-00000000000d' where salon_id = :'sa' and name = 'Ana Souza';
select id as ana from public.professionals where salon_id = :'sa' and name = 'Ana Souza' \gset
select id as bia from public.professionals where salon_id = :'sa' and name = 'Bia Martins' \gset
select id as corte from public.services where salon_id = :'sa' and name = 'Corte feminino' \gset
select id as escova from public.services where salon_id = :'sa' and name = 'Escova' \gset
select id as mani from public.services where salon_id = :'sa' and name = 'Manicure' \gset

-- Recepção: lê todos os clientes, cria agendamento, não mexe no catálogo
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa') = 30, 'recepção vê todos os clientes');
update public.services set price = 1 where id = :'corte';
select pg_temp.check((select price from public.services where id = :'corte') = 120, 'recepção não altera preço de serviço');
select pg_temp.check((select count(*) from public.audit_log) = 0, 'recepção não lê auditoria');

insert into public.clients (salon_id, name, phone) values (:'sa', 'Cliente Teste', '5511900000001') returning id as cli \gset
insert into public.clients (salon_id, name) values (:'sa', 'Cliente Sem Ana') returning id as cli_sem_ana \gset

-- Próxima segunda (fechado) e próxima terça às 10h, no fuso do salão, limpando a agenda da Ana nesse dia
select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 7) + time '10:00') at time zone 'America/Sao_Paulo' as segunda_10 \gset
select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 15) + time '10:00') at time zone 'America/Sao_Paulo' as terca_10 \gset
select ((date_trunc('week', now() at time zone 'America/Sao_Paulo')::date + 15) + time '12:00') at time zone 'America/Sao_Paulo' as terca_12 \gset

-- Agendamento com 2 serviços em sequência e troca de profissional
select public.create_appointment(:'sa', :'cli', jsonb_build_array(
  jsonb_build_object('service_id', :'corte', 'professional_id', :'ana', 'starts_at', :'terca_10'),
  jsonb_build_object('service_id', :'mani', 'professional_id', :'bia')
)) as ap1 \gset
select pg_temp.check((select ends_at - starts_at from public.appointments where id = :'ap1') = interval '105 minutes',
  'corte (60) + manicure (45) somam 105 min');
select pg_temp.check((select professional_id from public.appointment_items where appointment_id = :'ap1' and position = 1) = :'bia',
  'segundo serviço com outra profissional');
select pg_temp.check((select starts_at from public.appointment_items where appointment_id = :'ap1' and position = 1)
  = (:'terca_10')::timestamptz + interval '60 minutes', 'segundo serviço começa quando o primeiro termina');

-- Sobreposição bloqueada no banco
select pg_temp.expect_error(format($q$select public.create_appointment(%L, %L, jsonb_build_array(
  jsonb_build_object('service_id', %L, 'professional_id', %L, 'starts_at', %L::timestamptz + interval '30 minutes')))$q$,
  :'sa', :'cli', :'escova', :'ana', :'terca_10'), '23P01');
select pg_temp.check(true, 'sobreposição para a mesma profissional é recusada');

-- Encaixe passa por cima da trava
select public.create_appointment(:'sa', :'cli', jsonb_build_array(
  jsonb_build_object('service_id', :'escova', 'professional_id', :'ana',
                     'starts_at', (:'terca_10')::timestamptz + interval '30 minutes', 'is_squeeze', true))) as ap_enc \gset
select pg_temp.check(:'ap_enc' is not null, 'encaixe permite sobrepor');

-- Fora da jornada (segunda-feira) e no almoço
select pg_temp.expect_error(format($q$select public.create_appointment(%L, %L, jsonb_build_array(
  jsonb_build_object('service_id', %L, 'professional_id', %L, 'starts_at', %L)))$q$,
  :'sa', :'cli', :'escova', :'ana', :'segunda_10'), 'FORA_DA_JORNADA%');
select pg_temp.expect_error(format($q$select public.create_appointment(%L, %L, jsonb_build_array(
  jsonb_build_object('service_id', %L, 'professional_id', %L, 'starts_at', %L)))$q$,
  :'sa', :'cli', :'escova', :'ana', :'terca_12'), 'FORA_DA_JORNADA%');

-- Bloqueio de agenda
insert into public.schedule_blocks (salon_id, professional_id, kind, reason, starts_at, ends_at)
values (:'sa', :'bia', 'bloqueio', 'Curso', (:'terca_10')::timestamptz + interval '1 day', (:'terca_10')::timestamptz + interval '1 day 3 hours');
select pg_temp.expect_error(format($q$select public.create_appointment(%L, %L, jsonb_build_array(
  jsonb_build_object('service_id', %L, 'professional_id', %L, 'starts_at', %L::timestamptz + interval '1 day 1 hour')))$q$,
  :'sa', :'cli', :'mani', :'bia', :'terca_10'), 'BLOQUEIO%');

-- Cancelar libera o horário
select public.set_appointment_status(:'ap_enc', 'cancelado', 'cliente desistiu');
select public.set_appointment_status(:'ap1', 'cancelado', 'teste');
select pg_temp.check((select bool_and(not occupies) from public.appointment_items where appointment_id = :'ap1'), 'cancelado libera os itens');
select public.create_appointment(:'sa', :'cli', jsonb_build_array(
  jsonb_build_object('service_id', :'corte', 'professional_id', :'ana', 'starts_at', :'terca_10'))) as ap2 \gset
select pg_temp.check(:'ap2' is not null, 'horário cancelado pode ser reocupado');

-- Remarcar: original vira reagendado, novo horário nasce ligado a ele
select public.reschedule_appointment(:'ap2', (:'terca_10')::timestamptz + interval '1 day') as ap3 \gset
select pg_temp.check((select status from public.appointments where id = :'ap2') = 'reagendado', 'original fica Reagendado');
select pg_temp.check((select rescheduled_from_id from public.appointments where id = :'ap3') = :'ap2', 'novo aponta para o original');
select pg_temp.check((select starts_at from public.appointments where id = :'ap3') = (:'terca_10')::timestamptz + interval '1 day', 'novo horário aplicado');
select pg_temp.expect_error(format($q$select public.set_appointment_status(%L, 'confirmado')$q$, :'ap2'), '%já remarcado%');

-- Lista de espera sugere cliente quando um horário é cancelado
insert into public.clients (salon_id, name) values (:'sa', 'Cliente na Espera') returning id as cli_espera \gset
insert into public.waitlist (salon_id, client_id, service_id, period) values (:'sa', :'cli_espera', :'corte', 'manha');
insert into public.waitlist (salon_id, client_id, service_id, period) values (:'sa', :'cli_sem_ana', :'corte', 'noite');
select public.create_appointment(:'sa', :'cli', jsonb_build_array(
  jsonb_build_object('service_id', :'corte', 'professional_id', :'ana', 'starts_at', (:'terca_10')::timestamptz + interval '2 days'))) as ap4 \gset
select public.set_appointment_status(:'ap4', 'cancelado');

-- Profissional (Ana): só a própria agenda e os próprios clientes
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check(public.salon_role_of(:'sa') = 'profissional', 'Ana é profissional');
select pg_temp.check((select count(*) from public.clients where id = :'cli_sem_ana') = 0, 'Ana não vê cliente que nunca atendeu');
select pg_temp.check((select count(*) from public.clients where id = :'cli') = 1, 'Ana vê cliente que tem horário com ela');
select pg_temp.check((select count(*) from public.appointment_items where professional_id <> :'ana') = 0, 'Ana não vê itens das colegas');
select pg_temp.check((select count(*) from public.appointment_items where professional_id = :'ana') > 0, 'Ana vê os próprios itens');
select public.set_appointment_status(:'ap3', 'em_atendimento');
select pg_temp.check((select checked_in_at is not null from public.appointments where id = :'ap3'), 'início do atendimento carimbado');
select pg_temp.expect_error(format($q$select public.set_appointment_status(%L, 'cancelado')$q$, :'ap3'), '%Sem permissão%');
select pg_temp.expect_error(format(
  $q$select public.set_appointment_status((select a.id from public.appointments a where a.salon_id = %L and not public.professional_in_appointment(a.id) limit 1), 'concluido')$q$,
  :'sa'), '%');
update public.services set price = 1 where id = :'corte';
select pg_temp.check((select price from public.services where id = :'corte') = 120, 'profissional não altera serviços');

-- Admin: auditoria, sugestões da lista de espera, visão de clientes, último admin
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.audit_log where record_id = :'ap2') >= 2, 'auditoria registra criação e mudanças');
select pg_temp.check((select count(*) from public.waitlist_suggestions(:'ap4')) = 1, 'lista de espera sugere a cliente');
select pg_temp.check((select count(distinct lifecycle_status) from public.client_overview where salon_id = :'sa') >= 2, 'visão de clientes calcula status');
select pg_temp.check((select count(*) from public.client_overview where salon_id = :'sa' and total_spent > 0) > 10, 'visão de clientes soma total gasto');
select pg_temp.expect_error(format($q$update public.salon_members set role = 'recepcao' where salon_id = %L and user_id = auth.uid()$q$, :'sa'), '%pelo menos um administrador%');

-- Fotos exigem consentimento
select pg_temp.expect_error(format($q$insert into public.client_photos (salon_id, client_id, storage_path, created_by) values (%L, %L, 'x/y/z.jpg', auth.uid())$q$, :'sa', :'cli'), '%consentimento%');
update public.clients set photo_consent_at = now() where id = :'cli';
insert into public.client_photos (salon_id, client_id, storage_path, created_by) values (:'sa', :'cli', :'sa' || '/' || :'cli' || '/1.jpg', auth.uid());

-- Dono B não acessa a foto do salão A no storage
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(format($q$insert into storage.objects (bucket_id, name) values ('client-photos', %L)$q$, :'sa' || '/' || :'cli' || '/2.jpg'), '%row-level security%');

-- Salão suspenso: membros perdem o acesso
select pg_temp.as_postgres();
update public.salons set suspended_at = now() where id = :'sa';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.clients) = 0, 'salão suspenso não expõe dados');
select pg_temp.as_postgres();
