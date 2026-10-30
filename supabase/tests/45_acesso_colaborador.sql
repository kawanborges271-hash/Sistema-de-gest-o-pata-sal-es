-- Testes da 020: cada colaborador vê só o que é dele; o dono vê tudo e o resultado de cada um.
-- Roda depois de 40_phase4.sql e desfaz tudo no fim (o 50 continua vendo o mesmo banco).

\set ON_ERROR_STOP 1
begin;

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

select pg_temp.as_postgres();
select id as sa from public.salons where slug = 'studio-bela-flor' \gset
select timezone as tz from public.salons where id = :'sa' \gset
select (now() at time zone :'tz')::date as hoje \gset
select (:'hoje'::date - 29) as de \gset
select id as ana from public.professionals where salon_id = :'sa' and name = 'Ana Souza' \gset
select id as bia from public.professionals where salon_id = :'sa' and name = 'Bia Martins' \gset
select pg_temp.check((select user_id from public.professionals where id = :'ana') = :'prof', 'Ana tem o login do profissional');

-- ---------------------------------------------------------------------
-- Percentual de comissão: só o dono
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'prof');
select pg_temp.check((select count(*) from public.professionals where salon_id = :'sa') >= 3, 'profissional vê os nomes da equipe');
select pg_temp.expect_error('select default_commission_pct from public.professionals', '42501');
select pg_temp.expect_error('select * from public.professionals', '42501');
select pg_temp.expect_error('select commission_pct from public.professional_services', '42501');
select pg_temp.expect_error(format('select public.commission_rates(%L)', :'sa'), '42501');
select pg_temp.as_user(:'rec');
select pg_temp.expect_error(format('select public.commission_rates(%L)', :'sa'), '42501');
select pg_temp.check((select count(*) from public.professional_services where salon_id = :'sa') > 0, 'recepção lê preço e duração por profissional');
select pg_temp.as_postgres();
select default_commission_pct as bia_pct from public.professionals where id = :'bia' \gset
select pg_temp.as_user(:'admin');
select pg_temp.check((select (r ->> 'default_commission_pct')::numeric from jsonb_array_elements(public.commission_rates(:'sa') -> 'professionals') r
                      where (r ->> 'id')::uuid = :'bia') = :'bia_pct'::numeric, 'dono lê o percentual de cada um');
update public.professionals set default_commission_pct = 45 where id = :'bia';
select pg_temp.as_postgres();
select pg_temp.check((select default_commission_pct from public.professionals where id = :'bia') = 45, 'dono continua alterando o percentual');
select pg_temp.as_user(:'admin');
-- o que a tela do dono faz: cadastrar devolvendo o id, ligar/desligar login, gravar comissão por serviço
with ins as (insert into public.professionals (salon_id, name, default_commission_pct, active) values (:'sa', 'Teste Colunas', 33, false) returning id)
select id as tcol from ins \gset
update public.professionals set user_id = null where salon_id = :'sa' and user_id = '00000000-0000-0000-0000-0000000000ff';
insert into public.professional_services (salon_id, professional_id, service_id, commission_pct)
  select :'sa', :'tcol', id, 12 from public.services where salon_id = :'sa' limit 1;
select pg_temp.check((select count(*) from jsonb_array_elements(public.commission_rates(:'sa') -> 'services') r
                      where (r ->> 'professional_id')::uuid = :'tcol' and (r ->> 'commission_pct')::numeric = 12) = 1, 'comissão por serviço gravada e lida pelo dono');
delete from public.professional_services where professional_id = :'tcol';
select pg_temp.check(jsonb_array_length(public.commission_rates(:'sa') -> 'professionals') >= 3, 'dono lê os percentuais da equipe toda');
select pg_temp.as_user(:'dono_b');
select pg_temp.expect_error(format('select public.commission_rates(%L)', :'sa'), '42501');

-- ---------------------------------------------------------------------
-- Meu painel
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'prof');
select public.professional_panel(:'sa', :'de', :'hoje') as painel \gset
select pg_temp.check((:'painel'::jsonb -> 'professional' ->> 'id')::uuid = :'ana', 'profissional abre o próprio painel');
select pg_temp.as_postgres();
select pg_temp.check((:'painel'::jsonb -> 'current' ->> 'revenue')::numeric = (
  select coalesce(round(sum(i.total - case when o.subtotal > 0 then o.discount_amount * i.total / o.subtotal else 0 end), 2), 0)
  from public.order_items i join public.orders o on o.id = i.order_id
  where i.professional_id = :'ana' and o.status = 'fechada'
    and o.closed_at >= (:'de'::date::timestamp at time zone :'tz') and o.closed_at < ((:'hoje'::date + 1)::timestamp at time zone :'tz')),
  'faturamento dela = itens dela nas comandas fechadas, menos o desconto proporcional');
select pg_temp.check((:'painel'::jsonb -> 'current' ->> 'revenue')::numeric > 0, 'demo: Ana faturou no período');
select pg_temp.check((:'painel'::jsonb -> 'current' ->> 'commissions')::numeric = (
  select coalesce(sum(amount), 0) from public.commissions
  where professional_id = :'ana' and status <> 'estornada' and competence_date between :'de' and :'hoje'),
  'comissões do período são só as dela');
select pg_temp.check((select sum((x ->> 'current')::numeric) from jsonb_array_elements(:'painel'::jsonb -> 'series') x)
  = (:'painel'::jsonb -> 'current' ->> 'revenue')::numeric, 'gráfico soma o faturamento dela');
select pg_temp.check(jsonb_array_length(:'painel'::jsonb -> 'series') = 30, 'gráfico por dia');
select pg_temp.check((:'painel'::jsonb -> 'current' ->> 'occupancy')::numeric between 0 and 1, 'ocupação da agenda dela');
select pg_temp.check(not exists (
  select 1 from jsonb_array_elements(:'painel'::jsonb -> 'today') t
  where not exists (select 1 from public.appointment_items i where i.appointment_id = (t ->> 'id')::uuid and i.professional_id = :'ana')),
  'agenda de hoje só com horários dela');
select pg_temp.check(not exists (
  select 1 from jsonb_array_elements(:'painel'::jsonb -> 'to_call') t
  where not exists (select 1 from public.appointments a join public.appointment_items i on i.appointment_id = a.id
                    where a.client_id = (t ->> 'client_id')::uuid and i.professional_id = :'ana' and a.status = 'concluido')),
  'clientes para chamar são só clientes dela');
select pg_temp.check(not exists (
  select 1 from jsonb_array_elements(:'painel'::jsonb -> 'messages') m
  join public.message_queue q on q.id = (m ->> 'id')::uuid
  where not exists (select 1 from public.appointment_items i where i.appointment_id = q.appointment_id and i.professional_id = :'ana')),
  'mensagens automáticas só das clientes dela');
select pg_temp.check(not (:'painel'::jsonb ? 'share') and not (:'painel'::jsonb -> 'current' ? 'salon_revenue'),
                     'painel do profissional não mostra o total do salão');

-- Cliente dela que sumiu há 90 dias aparece para chamar
select pg_temp.as_postgres();
select id as escova from public.services where salon_id = :'sa' and name = 'Escova' \gset
insert into public.clients (salon_id, name, phone) values (:'sa', 'Sumiu Faz Tempo', '5511955550099') returning id as cli_ret \gset
select ((:'hoje'::date - 90) + time '10:00') at time zone :'tz' as ha90 \gset
insert into public.appointments (salon_id, client_id, status, starts_at, ends_at)
values (:'sa', :'cli_ret', 'concluido', :'ha90', :'ha90'::timestamptz + interval '1 hour') returning id as ap_ret \gset
insert into public.appointment_items (salon_id, appointment_id, service_id, professional_id, starts_at, ends_at, price, is_squeeze)
values (:'sa', :'ap_ret', :'escova', :'ana', :'ha90', :'ha90'::timestamptz + interval '1 hour', 80, true);
select pg_temp.as_user(:'prof');
select pg_temp.check(exists (select 1 from jsonb_array_elements(public.professional_panel(:'sa', :'de', :'hoje') -> 'to_call') t
                             where (t ->> 'client_id')::uuid = :'cli_ret' and t ->> 'last_service' = 'Escova'),
                     'cliente dela sumida há 90 dias aparece para chamar, com o último serviço');
select pg_temp.as_user(:'admin');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.professional_panel(:'sa', :'de', :'hoje', :'bia') -> 'to_call') t
                                 where (t ->> 'client_id')::uuid = :'cli_ret'), 'não aparece na lista da colega');
select pg_temp.as_postgres();
update public.clients set opt_out = true where id = :'cli_ret';
select pg_temp.as_user(:'prof');
select pg_temp.check(not exists (select 1 from jsonb_array_elements(public.professional_panel(:'sa', :'de', :'hoje') -> 'to_call') t
                                 where (t ->> 'client_id')::uuid = :'cli_ret'), 'quem pediu para não receber mensagem não aparece');

-- Ninguém abre o painel de outra pessoa, só o dono
select pg_temp.expect_error(format('select public.professional_panel(%L, %L, %L, %L)', :'sa', :'de', :'hoje', :'bia'), '42501');
select pg_temp.check((public.professional_panel(:'sa', :'de', :'hoje', :'ana') -> 'professional' ->> 'id')::uuid = :'ana',
                     'passar o próprio id funciona');
select pg_temp.as_user(:'rec');
select pg_temp.expect_error(format('select public.professional_panel(%L, %L, %L)', :'sa', :'de', :'hoje'), 'SEM_CADASTRO%');
select pg_temp.expect_error(format('select public.professional_panel(%L, %L, %L, %L)', :'sa', :'de', :'hoje', :'ana'), '42501');
select pg_temp.as_user(:'dono_b');
select pg_temp.expect_error(format('select public.professional_panel(%L, %L, %L, %L)', :'sa', :'de', :'hoje', :'ana'), '42501');
select pg_temp.as_user(:'intrusa');
select pg_temp.expect_error(format('select public.professional_panel(%L, %L, %L)', :'sa', :'de', :'hoje'), '42501');
select pg_temp.as_user(:'admin');
select pg_temp.check((public.professional_panel(:'sa', :'de', :'hoje', :'bia') -> 'professional' ->> 'id')::uuid = :'bia',
                     'dono abre o painel de qualquer profissional');
select pg_temp.expect_error(format('select public.professional_panel(%L, %L, %L)', :'sa', :'de', :'hoje'), 'SEM_CADASTRO%');
select pg_temp.expect_error(format('select public.professional_panel(%L, %L, %L, %L)', :'sa', :'hoje', :'de', :'bia'), '%Período inválido%');

-- Funções internas continuam fechadas
select pg_temp.as_user(:'prof');
select pg_temp.expect_error(format('select public.professional_period(%L, %L, %L, %L)', :'sa', :'bia', :'de', :'hoje'), '42501');

-- ---------------------------------------------------------------------
-- Resultado da equipe (dono)
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'admin');
select public.team_report(:'sa', :'de', :'hoje') as equipe \gset
select pg_temp.check((:'equipe'::jsonb ->> 'revenue')::numeric
  = (public.dashboard_summary(:'sa', :'de', :'hoje') -> 'current' ->> 'revenue')::numeric, 'total da equipe = faturamento do dashboard');
select pg_temp.check(jsonb_array_length(:'equipe'::jsonb -> 'professionals') >= 3, 'uma linha por profissional');
select pg_temp.check(abs((select sum((r -> 'current' ->> 'revenue')::numeric) from jsonb_array_elements(:'equipe'::jsonb -> 'professionals') r)
  + (:'equipe'::jsonb ->> 'unassigned_revenue')::numeric - (:'equipe'::jsonb ->> 'revenue')::numeric) < 0.01,
  'soma das pessoas + sem profissional = total do salão');
select pg_temp.check((select (r ->> 'share')::numeric = round((r -> 'current' ->> 'revenue')::numeric / (:'equipe'::jsonb ->> 'revenue')::numeric, 4)
                      from jsonb_array_elements(:'equipe'::jsonb -> 'professionals') r where (r ->> 'professional_id')::uuid = :'ana'),
                     'percentual de cada um sobre o total do salão');
select pg_temp.check((select (r -> 'current' ->> 'revenue')::numeric from jsonb_array_elements(:'equipe'::jsonb -> 'professionals') r
                      where (r ->> 'professional_id')::uuid = :'ana') = (:'painel'::jsonb -> 'current' ->> 'revenue')::numeric,
                     'o que o dono vê da Ana é o mesmo que ela vê');
select pg_temp.as_user(:'prof');
select pg_temp.expect_error(format('select public.team_report(%L, %L, %L)', :'sa', :'de', :'hoje'), '42501');
select pg_temp.as_user(:'rec');
select pg_temp.expect_error(format('select public.team_report(%L, %L, %L)', :'sa', :'de', :'hoje'), '42501');
select pg_temp.as_user(:'dono_b');
select pg_temp.expect_error(format('select public.team_report(%L, %L, %L)', :'sa', :'de', :'hoje'), '42501');

-- ---------------------------------------------------------------------
-- Convite aceito liga o login ao cadastro com o mesmo e-mail
-- ---------------------------------------------------------------------
select pg_temp.as_postgres();
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'carla@exemplo.com');
insert into public.professionals (salon_id, name, email, active) values (:'sa', 'Carla Nova', 'Carla@Exemplo.com ', false) returning id as carla \gset
insert into public.invitations (salon_id, email, role, invited_by) values (:'sa', 'carla@exemplo.com', 'profissional', :'admin')
  returning token as tok \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select public.accept_invitation(:'tok');
select pg_temp.check(public.my_professional_id(:'sa') = :'carla', 'convite aceito liga o login ao cadastro dela');
select pg_temp.check((public.professional_panel(:'sa', :'de', :'hoje') -> 'professional' ->> 'id')::uuid = :'carla', 'e ela já abre o próprio painel');
select pg_temp.check((select count(*) from public.appointments) = 0, 'sem atendimentos, não vê a agenda de ninguém');

rollback;
