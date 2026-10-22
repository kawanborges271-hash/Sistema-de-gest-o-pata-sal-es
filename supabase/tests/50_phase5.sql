-- Testes da Fase 5: Painel SaaS (super admin), planos e limites.
-- Roda depois de 40_phase4.sql (usa os salões e usuários de lá).

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

\set admin '00000000-0000-0000-0000-00000000000a'
\set dono_b '00000000-0000-0000-0000-00000000000b'
\set rec '00000000-0000-0000-0000-00000000000c'
\set prof '00000000-0000-0000-0000-00000000000d'
\set intrusa '00000000-0000-0000-0000-00000000000e'
\set suporte '00000000-0000-0000-0000-00000000000f'

select pg_temp.as_postgres();
insert into auth.users (id, email, raw_user_meta_data, last_sign_in_at)
values (:'suporte', 'suporte@salonos.com', '{"full_name":"Suporte"}', now());
insert into public.platform_admins (user_id) values (:'suporte');
select id as sa from public.salons where slug = 'studio-bela-flor' \gset
select id as sb from public.salons where slug = 'barbearia-do-ze' \gset
select timezone as tz from public.salons where id = :'sb' \gset

select pg_temp.check((select plan_id from public.salons where id = :'sa') = 'basico', 'salão novo entra no plano Básico');

-- ---------------------------------------------------------------------
-- Quem acessa o painel
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'admin');
select pg_temp.expect_error($$select * from public.platform_salons()$$, '42501');
select pg_temp.expect_error($$select public.platform_overview()$$, '42501');
select pg_temp.expect_error(format($$select public.platform_set_plan(%L, 'pro')$$, :'sa'), '42501');
select pg_temp.expect_error(format($$update public.salons set plan_id = 'pro' where id = %L$$, :'sa'), '42501');
select pg_temp.expect_error(format($$update public.salons set suspended_at = now() where id = %L$$, :'sa'), '42501');
update public.salons set name = 'Studio Bela Flor' where id = :'sa';
select pg_temp.check(true, 'dono do salão não muda o próprio plano nem a suspensão, mas edita o resto');
select pg_temp.check((select count(*) from public.platform_audit) = 0, 'histórico do painel é invisível para o salão');
select pg_temp.check((public.salon_plan_usage(:'sa') ->> 'professionals')::int = 3, 'dono vê o uso do plano (3 profissionais)');
select pg_temp.as_user(:'rec');
select pg_temp.expect_error(format($$select public.salon_plan_usage(%L)$$, :'sa'), '42501');

-- ---------------------------------------------------------------------
-- Uso por salão, sem valores financeiros
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'suporte');
select pg_temp.check((select count(*) from public.platform_salons()) = (select count(*) from public.salons), 'painel lista todos os salões');
select pg_temp.check((select team = 3 and professionals = 3 and clients >= 30 and appointments_30d > 0 and owner_email = 'dona@bela.com'
                      and last_activity_at is not null
                      from public.platform_salons() where id = :'sa'), 'uso do salão: equipe, profissionais, clientes, agendamentos, dono e última atividade');
select pg_temp.check((select not exists (
                        select 1 from public.platform_salons() p, jsonb_object_keys(to_jsonb(p)) k
                        where k ~ '(revenue|total|faturamento|valor|ticket|price|amount|commission)')),
                     'painel não devolve nenhuma coluna de valor');
select pg_temp.check((select count(*) from public.orders where salon_id = :'sa') = 0, 'super admin não lê comandas do salão');
select pg_temp.check((select count(*) from public.cash_sessions where salon_id = :'sa') = 0, 'super admin não lê o caixa');
select pg_temp.expect_error(format($$select public.dashboard_summary(%L, current_date - 7, current_date)$$, :'sa'), '42501');
select pg_temp.check((public.platform_overview() ->> 'salons')::int = (select count(*) from public.salons), 'visão geral conta os salões');

-- ---------------------------------------------------------------------
-- Limite de profissionais
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'admin');
select pg_temp.expect_error(format($$insert into public.professionals (salon_id, name) values (%L, 'Quarta')$$, :'sa'), 'LIMITE_PLANO%');
insert into public.professionals (salon_id, name, active) values (:'sa', 'Quarta', false);
select pg_temp.expect_error(format($$update public.professionals set active = true where salon_id = %L and name = 'Quarta'$$, :'sa'), 'LIMITE_PLANO%');
update public.professionals set name = 'Quarta Pessoa' where salon_id = :'sa' and name = 'Quarta';
select pg_temp.check(true, 'profissional inativo entra e pode ser editado sem contar no limite');

select pg_temp.as_user(:'suporte');
select public.platform_set_plan(:'sa', 'pro');
select pg_temp.as_user(:'admin');
update public.professionals set active = true where salon_id = :'sa' and name = 'Quarta Pessoa';
select pg_temp.check((public.salon_plan_usage(:'sa') ->> 'professionals')::int = 4, 'no Pro o quarto profissional fica ativo');
select pg_temp.as_user(:'suporte');
select public.platform_set_plan(:'sa', 'basico');
select pg_temp.as_user(:'admin');
update public.professionals set role_title = 'Cabeleireira' where salon_id = :'sa' and name = 'Quarta Pessoa';
select pg_temp.check((select count(*) from public.professionals where salon_id = :'sa' and active) = 4,
                     'plano menor não desativa ninguém, só barra novos ativos');
update public.professionals set active = false where salon_id = :'sa' and name = 'Quarta Pessoa';

-- ---------------------------------------------------------------------
-- Limite de mensagens por mês
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'suporte');
select public.platform_save_plan('basico', 'Básico', 3, 2);
select pg_temp.as_postgres();
select ((date_trunc('day', now() at time zone :'tz') + interval '12 hours') at time zone :'tz') as meio_dia \gset
update public.message_queue set status = 'cancelada' where salon_id = :'sb' and status = 'pendente';
insert into public.whatsapp_integrations (salon_id, instance_id, token, active, status)
values (:'sb', 'inst-b', 'tok-b', true, 'conectado')
on conflict (salon_id) do update set instance_id = 'inst-b', token = 'tok-b', active = true, status = 'conectado';
insert into public.message_queue (salon_id, phone, body, kind, scheduled_for)
select :'sb', '5511990000' || lpad(g::text, 3, '0'), 'Oi ' || g, 'manual', :'meio_dia'::timestamptz - interval '1 minute'
from generate_series(1, 3) g;
select pg_temp.check((select count(*) from public.claim_whatsapp_messages(:'meio_dia'::timestamptz, 10) where salon_id = :'sb') = 2,
                     'só saem as mensagens que cabem no mês');
update public.message_queue set status = 'enviada', sent_at = :'meio_dia'::timestamptz where salon_id = :'sb' and status = 'enviando';
select pg_temp.check((select count(*) from public.claim_whatsapp_messages(:'meio_dia'::timestamptz + interval '5 minutes', 10) where salon_id = :'sb') = 0,
                     'teto do mês atingido: nada sai');
select pg_temp.check((select count(*) from public.message_queue where salon_id = :'sb' and status = 'pendente') = 1, 'a que passou do teto continua na fila');
select count(*) from public.claim_whatsapp_messages(:'meio_dia'::timestamptz + interval '10 minutes', 10) \gset
select pg_temp.check((select count(*) from public.notifications where salon_id = :'sb' and kind = 'limite_plano') = 1,
                     'dono recebe um aviso só uma vez no mês');
select pg_temp.as_user(:'suporte');
select public.platform_set_plan(:'sb', 'pro');
select pg_temp.as_postgres();
select pg_temp.check((select count(*) from public.claim_whatsapp_messages(:'meio_dia'::timestamptz + interval '15 minutes', 10) where salon_id = :'sb') = 1,
                     'mudando para o Pro a fila volta a andar');
select pg_temp.as_user(:'suporte');
select pg_temp.check((select messages_month = 3 and max_messages_month = 10000 from public.platform_salons() where id = :'sb'),
                     'painel mostra mensagens do mês e o teto do plano');
select public.platform_save_plan('basico', 'Básico', 3, 1000);

-- ---------------------------------------------------------------------
-- Criar salão
-- ---------------------------------------------------------------------
select public.platform_create_salon('Espaço Intrusa', 'INTRUSA@x.com', 'basico') as novo \gset
select (:'novo'::jsonb ->> 'salon_id')::uuid as sc \gset
select pg_temp.check((:'novo'::jsonb ->> 'invitation_token') is null
                     and exists (select 1 from public.platform_salon_members(:'sc') where email = 'intrusa@x.com' and role = 'admin' and active),
                     'dono já cadastrado vira admin na hora');
select pg_temp.as_postgres();
select pg_temp.check((select count(*) from public.payment_methods where salon_id = :'sc') > 0
                     and (select count(*) from public.automations where salon_id = :'sc') > 0,
                     'salão criado pelo painel já vem com formas de pagamento e automações');
select pg_temp.as_user(:'suporte');
select public.platform_create_salon('Studio Novo', 'nova.dona@exemplo.com', 'pro', 'America/Manaus') as novo2 \gset
select pg_temp.check((:'novo2'::jsonb ->> 'invitation_token') is not null
                     and (select plan_id = 'pro' and timezone = 'America/Manaus' and not onboarding_completed
                          from public.salons where id = (:'novo2'::jsonb ->> 'salon_id')::uuid),
                     'dono sem conta recebe convite de admin; plano e fuso escolhidos');
select pg_temp.expect_error($$select public.platform_create_salon('Salão X', 'sem-email', 'basico')$$, 'E-mail%');
select pg_temp.expect_error($$select public.platform_create_salon('Salão Y', 'y@y.com', 'ouro')$$, 'Plano%');
select pg_temp.expect_error($$select public.platform_create_salon('Salão Z', 'z@z.com', 'basico', 'Lua/Base')$$, 'Fuso%');

select pg_temp.as_postgres();
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000010', 'nova.dona@exemplo.com');
select pg_temp.as_user('00000000-0000-0000-0000-000000000010');
select public.accept_invitation((:'novo2'::jsonb ->> 'invitation_token')::uuid);
select pg_temp.check(public.is_salon_admin((:'novo2'::jsonb ->> 'salon_id')::uuid), 'nova dona aceita o convite e vira admin');

-- ---------------------------------------------------------------------
-- Suspender e reativar
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'suporte');
select pg_temp.expect_error(format($$select public.platform_set_suspended(%L, true, '')$$, :'sb'), '%motivo%');
select public.platform_set_suspended(:'sb', true, 'Mensalidade em atraso');
select pg_temp.as_user(:'dono_b');
select pg_temp.check((select count(*) from public.clients where salon_id = :'sb') = 0, 'salão suspenso: dono perde o acesso aos dados');
select pg_temp.check(not public.is_salon_member(:'sb'), 'salão suspenso: ninguém é membro ativo');
select pg_temp.as_user(:'suporte');
select pg_temp.check((select suspended_reason = 'Mensalidade em atraso' from public.platform_salons() where id = :'sb'), 'motivo fica no painel');
select public.platform_set_suspended(:'sb', false);
select pg_temp.as_user(:'dono_b');
select pg_temp.check(public.is_salon_member(:'sb'), 'reativado: acesso volta');

-- ---------------------------------------------------------------------
-- Mover usuários entre salões
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'suporte');
select pg_temp.check((select count(*) from public.platform_search_users('recepcao@bela')) = 1, 'busca usuário por e-mail');
select public.platform_move_user(:'rec', :'sa', :'sc', 'recepcao');
select pg_temp.check((select not active from public.platform_salon_members(:'sa') where user_id = :'rec')
                     and (select active and role = 'recepcao' from public.platform_salon_members(:'sc') where user_id = :'rec'),
                     'mover: vínculo antigo fica inativo (histórico) e o novo ativo');
select pg_temp.as_user(:'rec');
select pg_temp.check(not public.is_salon_member(:'sa') and public.is_salon_member(:'sc'), 'usuário movido só acessa o salão novo');
select pg_temp.as_user(:'suporte');
select public.platform_move_user(:'prof', :'sa', :'sc', 'profissional');
select pg_temp.as_postgres();
select pg_temp.check((select user_id is null and active from public.professionals where salon_id = :'sa' and name = 'Ana Souza'),
                     'login de profissional do salão antigo é desligado, o cadastro fica');
select pg_temp.as_user(:'suporte');
select public.platform_move_user(:'rec', null, :'sa', 'recepcao');
select pg_temp.check((select active from public.platform_salon_members(:'sa') where user_id = :'rec')
                     and (select active from public.platform_salon_members(:'sc') where user_id = :'rec'),
                     'adicionar sem origem mantém os outros salões');
select pg_temp.expect_error(format($$select public.platform_move_user(%L, %L, %L, 'admin')$$, :'admin', :'sa', :'sb'), '%administrador%');
select pg_temp.expect_error(format($$select public.platform_move_user(%L, %L, %L, 'admin')$$, :'intrusa', :'sa', :'sb'), '%origem%');

-- ---------------------------------------------------------------------
-- Histórico
-- ---------------------------------------------------------------------
select pg_temp.check((select count(*) from public.platform_audit_list(100) where action in
                      ('criar_salao', 'suspender', 'reativar', 'mudar_plano', 'editar_plano', 'mover_usuario', 'adicionar_usuario')) >= 10,
                     'cada ação do painel fica no histórico com autor');
select pg_temp.as_postgres();
select pg_temp.check((select count(*) from public.audit_log where table_name = 'salon_members' and salon_id = :'sc') >= 3,
                     'entradas e saídas de equipe vão para o audit_log do salão');
select pg_temp.as_user(:'admin');
select pg_temp.expect_error($$select * from public.platform_audit_list(10)$$, '42501');
select pg_temp.expect_error($$select * from public.platform_search_users('bela')$$, '42501');
select pg_temp.as_postgres();

-- Revisão: esperado do caixa e data da lista de espera
select id as caixa_a from public.cash_sessions where salon_id = :'sa' order by opened_at desc limit 1 \gset
select pg_temp.as_user(:'admin');
select pg_temp.check(public.cash_session_expected(:'caixa_a') is not null, 'admin vê o esperado do próprio caixa');
select pg_temp.as_user(:'dono_b');
select pg_temp.check(public.cash_session_expected(:'caixa_a') is null, 'dona de outro salão não vê o esperado do caixa');
select pg_temp.as_user(:'prof');
select pg_temp.check(public.cash_session_expected(:'caixa_a') is null, 'profissional não vê o esperado do caixa');
select pg_temp.as_postgres();
update public.salons set timezone = 'Pacific/Kiritimati' where id = :'sa';
insert into public.waitlist (salon_id, client_id, period)
select :'sa', id, 'qualquer' from public.clients where salon_id = :'sa' limit 1 returning id as espera \gset
select pg_temp.check((select date_from from public.waitlist where id = :'espera') = (now() at time zone 'Pacific/Kiritimati')::date,
                     'lista de espera começa em "hoje" no fuso do salão');
update public.salons set timezone = 'America/Sao_Paulo' where id = :'sa';

-- Suporte: super admin lê a operação de qualquer salão só em transação de leitura
select pg_temp.as_user(:'suporte');
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa') = 0,
                     'fora do modo leitura o super admin continua sem ver clientes');
select pg_temp.expect_error(format($$select public.dashboard_summary(%L, current_date - 30, current_date)$$, :'sa'), '%');
select pg_temp.as_postgres();

start transaction read only;
select pg_temp.as_user(:'suporte');
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa') > 0, 'modo leitura: super admin vê os clientes');
select pg_temp.check((select count(*) from public.cash_sessions where salon_id = :'sa') > 0, 'modo leitura: super admin vê o caixa');
select pg_temp.check((select count(*) from public.orders where salon_id = :'sa') > 0, 'modo leitura: super admin vê as comandas');
select pg_temp.check(public.dashboard_summary(:'sa', current_date - 30, current_date) is not null,
                     'modo leitura: super admin abre o dashboard');
select pg_temp.check(public.cash_session_expected(:'caixa_a') is not null, 'modo leitura: super admin vê o esperado do caixa');
select pg_temp.expect_error(format($$update public.clients set name = 'x' where salon_id = %L$$, :'sa'), '25006');
commit;
select pg_temp.as_postgres();

select pg_temp.as_user(:'suporte');
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa' and name = 'x') = 0, 'nada foi alterado');
select public.platform_view_salon(:'sa');
select pg_temp.as_user(:'admin');
select pg_temp.expect_error(format($$select public.platform_view_salon(%L)$$, :'sa'), '42501');
select pg_temp.as_postgres();
select pg_temp.check((select count(*) from public.platform_audit where action = 'ver_operacao' and salon_id = :'sa') = 1,
                     'entrada do suporte no salão fica no histórico');

-- Apagar um salão inteiro leva a equipe e o histórico junto; remover o último admin continua proibido
select pg_temp.as_postgres();
select pg_temp.expect_error(format($$delete from public.salon_members where salon_id = %L and role = 'admin'$$, :'sa'), '%');
delete from public.salons where id = :'sa';
select pg_temp.check(not exists (select 1 from public.clients where salon_id = :'sa')
                     and not exists (select 1 from public.salon_members where salon_id = :'sa')
                     and not exists (select 1 from public.audit_log where salon_id = :'sa'),
                     'salão apagado leva clientes, equipe e histórico');

-- Salão de demonstração do super admin: criado uma vez, com dados, e operado sem modo leitura
select pg_temp.as_user(:'suporte');
select public.platform_demo_salon() as demo \gset
select pg_temp.check(public.platform_demo_salon() = :'demo', 'demonstração reaproveita o mesmo salão');
select pg_temp.check((select count(*) from public.clients where salon_id = :'demo') > 0, 'demonstração vem com dados');
update public.clients set notes = 'editado na demo' where salon_id = :'demo';
select pg_temp.check((select count(*) from public.clients where salon_id = :'demo' and notes = 'editado na demo') > 0,
                     'super admin altera dados na demonstração');
select pg_temp.as_user(:'admin');
select pg_temp.expect_error('select public.platform_demo_salon()', '42501');
select pg_temp.as_postgres();
