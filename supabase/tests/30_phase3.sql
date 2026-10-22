-- Testes da Fase 3: CRM, WhatsApp (Z-API), automações e agendamento online.
-- Roda depois de 20_phase2.sql (usa o salão de demonstração e os usuários de lá).

\set ON_ERROR_STOP 1

create or replace function pg_temp.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, false);
  execute 'set role authenticated';
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
end $$;

create or replace function pg_temp.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role service_role';
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

-- Envia (de mentira) tudo o que a fila liberar e devolve quantas saíram
create or replace function pg_temp.dispatch(p_now timestamptz default now()) returns int language plpgsql as $$
declare
  r record;
  n int := 0;
begin
  for r in select * from public.claim_whatsapp_messages(p_now, 50) loop
    perform public.report_whatsapp_result(r.id, true, 'zapi-' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function pg_temp.dispatch(timestamptz) to service_role;

select pg_temp.as_postgres();
select id as sa from public.salons where slug = 'studio-bela-flor' \gset
select id as sb from public.salons where slug = 'barbearia-do-ze' \gset
select timezone as tz from public.salons where id = :'sa' \gset
select id as ana from public.professionals where salon_id = :'sa' and name = 'Ana Souza' \gset
select id as bia from public.professionals where salon_id = :'sa' and name = 'Bia Martins' \gset
select id as escova from public.services where salon_id = :'sa' and name = 'Escova' \gset
select id as mani from public.services where salon_id = :'sa' and name = 'Manicure' \gset
-- janela de envio o dia todo, para os testes não dependerem do relógio
update public.salons set wa_window_start = '00:00', wa_window_end = '23:59', wa_spacing_seconds = 5 where id = :'sa';
select (current_date + 2 + time '11:00') at time zone :'tz' as em_2d \gset
select (current_date + 3 + time '11:00') at time zone :'tz' as em_3d \gset
select (current_date + 4 + time '11:00') at time zone :'tz' as em_4d \gset

-- ---------------------------------------------------------------------
-- Demonstração
-- ---------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(distinct stage) from public.leads where salon_id = :'sa') >= 7, 'demo: leads em todas as etapas do CRM');
select pg_temp.check((select count(*) from public.message_queue where salon_id = :'sa' and status = 'enviada') > 50, 'demo: histórico de mensagens enviadas');
select pg_temp.check((select count(*) from public.client_feedback where salon_id = :'sa') > 0, 'demo: notas do pós-atendimento');
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa' and is_demo) = 30, 'demo: clientes marcados como demonstração');
select pg_temp.check((select count(*) from public.opt_outs where salon_id = :'sa') = 1, 'demo: um opt-out');
select pg_temp.check((select count(*) from public.automations where salon_id = :'sa') = 12, '12 automações criadas para o salão');
select pg_temp.as_postgres();
select pg_temp.check((select count(*) from public.automations where salon_id = :'sb') = 12, 'salão sem demonstração também ganha as automações');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');

-- ---------------------------------------------------------------------
-- Integração: token nunca sai do servidor
-- ---------------------------------------------------------------------
select public.save_whatsapp_integration(:'sa', 'INST3A2B1C', 'tok_super_secreto_9876', 'clienttok', '(11) 98888-7777', 'https://app.exemplo.com/');
select pg_temp.check((select token_hint from public.whatsapp_integration_status(:'sa')) = '••••9876', 'status mostra só os 4 últimos do token');
select pg_temp.check((select configured and active and client_token_set from public.whatsapp_integration_status(:'sa')), 'integração configurada');
select pg_temp.check((select app_url from public.salons where id = :'sa') = 'https://app.exemplo.com', 'url do app salva para os links');
select webhook_secret as secret from public.whatsapp_integration_status(:'sa') \gset
select pg_temp.expect_error('select * from public.whatsapp_integrations', '%permission denied%');
select pg_temp.expect_error(format($q$select public.whatsapp_credentials(%L)$q$, :'sa'), '%permission denied%');
select pg_temp.expect_error(format($q$select public.save_whatsapp_integration(%L, 'x', 'y')$q$, :'sa'), '%inválido%');
select public.save_whatsapp_integration(:'sa', 'INST3A2B1C');
select pg_temp.check((select token_hint from public.whatsapp_integration_status(:'sa')) = '••••9876', 'salvar sem token mantém o atual');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error(format($q$select * from public.whatsapp_integration_status(%L)$q$, :'sa'), '42501');
select pg_temp.expect_error(format($q$select public.whatsapp_inbound(%L, %L, 'INST3A2B1C', 'm1', '5511900000001', 'X', 'oi')$q$, :'sa', :'secret'), '%permission denied%');
select pg_temp.expect_error('select * from public.claim_whatsapp_messages()', '%permission denied%');
select pg_temp.expect_error('select public.run_automations()', '%permission denied%');

-- ---------------------------------------------------------------------
-- Webhook: mensagem de número desconhecido vira lead
-- ---------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.expect_error(format($q$select public.whatsapp_inbound(%L, 'errado', 'INST3A2B1C', 'm1', '5511900000001', 'X', 'oi')$q$, :'sa'), 'SEGREDO_INVALIDO');
select pg_temp.expect_error(format($q$select public.whatsapp_inbound(%L, %L, 'OUTRA', 'm1', '5511900000001', 'X', 'oi')$q$, :'sa', :'secret'), 'INSTANCIA_INVALIDA');
select pg_temp.check(public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-001', '5511912345678', 'Paula Nova', 'Oi, vocês fazem luzes?') ->> 'action' = 'novo_lead',
  'número desconhecido cria lead');
select pg_temp.check(public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-001', '5511912345678', 'Paula Nova', 'Oi, vocês fazem luzes?') ->> 'action' = 'duplicada',
  'webhook repetido não duplica');
-- Z-API às vezes manda sem o 9 do celular
select public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-002', '551112345678', 'Paula Nova', 'Quanto custa?');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select id as lead_paula from public.leads where salon_id = :'sa' and name = 'Paula Nova' \gset
select pg_temp.check((select count(*) from public.leads where salon_id = :'sa' and name = 'Paula Nova') = 1, 'mesmo número sem o 9 cai no mesmo lead');
select pg_temp.check((select stage = 'novo' and origin = 'whatsapp' and last_message = 'Quanto custa?' from public.leads where id = :'lead_paula'),
  'lead do WhatsApp em "Novo lead" com a última mensagem');
select pg_temp.check((select count(*) from public.whatsapp_messages where lead_id = :'lead_paula') = 2, 'conversa registrada');
select pg_temp.check(exists (select 1 from public.notifications where salon_id = :'sa' and kind = 'novo_lead' and link like '%' || :'lead_paula'), 'sino avisa do lead novo');

-- ---------------------------------------------------------------------
-- CRM
-- ---------------------------------------------------------------------
select public.send_whatsapp_message(:'sa', '5511912345678', 'Fazemos sim! Quer marcar?', null, :'lead_paula');
select pg_temp.check((select stage from public.leads where id = :'lead_paula') = 'em_contato', 'primeira resposta tira o lead de "Novo lead"');
select pg_temp.expect_error(format($q$update public.leads set stage = 'perdido' where id = %L$q$, :'lead_paula'), '%check%');
insert into public.leads (salon_id, name, phone, origin, interest, created_by)
  values (:'sa', 'Lead Manual', '(11) 97777-6666', 'instagram', 'Mechas', auth.uid()) returning id as lead_manual \gset
select pg_temp.check((select phone from public.leads where id = :'lead_manual') = '5511977776666', 'telefone do lead normalizado');
update public.leads set stage = 'follow_up', next_follow_up_at = now() + interval '1 day' where id = :'lead_manual';
select pg_temp.check((select count(*) from public.lead_stage_history where lead_id = :'lead_manual') = 2, 'histórico de etapas');
select pg_temp.check((select not automatic from public.lead_stage_history where lead_id = :'lead_manual' and to_stage = 'follow_up'), 'mudança manual não é automática');

select public.convert_lead(:'lead_paula') as cli_paula \gset
select pg_temp.check((select origin = 'whatsapp' and phone = '5511912345678' from public.clients where id = :'cli_paula'), 'lead vira cliente com origem e telefone');
select public.create_appointment(:'sa', :'cli_paula', jsonb_build_array(jsonb_build_object(
  'service_id', :'escova', 'professional_id', :'ana', 'starts_at', :'em_2d', 'is_squeeze', true))) as ap_paula \gset
select pg_temp.check((select stage from public.leads where id = :'lead_paula') = 'agendado', 'agendamento move o card para "Agendado"');
select pg_temp.check((select automatic from public.lead_stage_history where lead_id = :'lead_paula' and to_stage = 'agendado'), 'mudança pela agenda é automática');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_paula' and kind = 'confirmacao_agendamento' and status = 'pendente') = 1,
  'confirmação do agendamento entra na fila');
select pg_temp.check((select body from public.message_queue where appointment_id = :'ap_paula' and kind = 'confirmacao_agendamento') like 'Oi, Paula! %Escova com Ana Souza%',
  'texto da confirmação com as variáveis preenchidas');

insert into public.clients (salon_id, name, phone) values (:'sa', 'Lead Manual', '11977776666') returning id as cli_manual \gset
select pg_temp.check((select client_id from public.leads where id = :'lead_manual') = :'cli_manual', 'cliente cadastrado com o telefone do lead liga os dois');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) from public.leads) = 0, 'profissional não vê o CRM');
select pg_temp.check((select count(*) from public.message_queue) = 0, 'profissional não vê a fila');
select pg_temp.expect_error(format($q$select public.send_whatsapp_message(%L, '5511912345678', 'oi')$q$, :'sa'), '42501');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) from public.leads where salon_id = :'sa') = 0, 'outro salão não vê os leads');

-- ---------------------------------------------------------------------
-- Envio e respostas SIM / NÃO
-- ---------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.check(pg_temp.dispatch() >= 2, 'fila libera as mensagens pendentes');
select pg_temp.check((select status from public.message_queue where appointment_id = :'ap_paula' and kind = 'confirmacao_agendamento') = 'enviada', 'confirmação enviada');
select pg_temp.check(not exists (select 1 from public.message_queue q join public.clients c on c.id = q.client_id
  where c.is_demo and (q.status = 'enviando' or q.provider_message_id like 'zapi-%')), 'nada sai para cliente da demonstração');
select pg_temp.as_postgres();
insert into public.message_queue (salon_id, client_id, phone, body, kind)
  select :'sa', id, phone, 'Para cliente da demo', 'manual' from public.clients where salon_id = :'sa' and is_demo and not opt_out limit 1
  returning id as msg_demo \gset
select pg_temp.as_service();
select pg_temp.dispatch();
select pg_temp.check((select status = 'ignorada' and last_error = 'Cliente de demonstração' from public.message_queue where id = :'msg_demo'),
  'mensagem para cliente da demonstração é ignorada com o motivo');
select pg_temp.check(public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-003', '5511912345678', 'Paula', 'Sim, confirmo!') ->> 'action' = 'confirmado', 'SIM confirma');
select pg_temp.check((select status from public.appointments where id = :'ap_paula') = 'confirmado', 'agendamento confirmado pela resposta');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.create_appointment(:'sa', :'cli_paula', jsonb_build_array(jsonb_build_object(
  'service_id', :'escova', 'professional_id', :'ana', 'starts_at', :'em_3d', 'is_squeeze', true))) as ap_paula2 \gset
select pg_temp.as_service();
select pg_temp.dispatch();
select pg_temp.check(public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-004', '5511912345678', 'Paula', 'Não posso, surgiu um imprevisto') ->> 'action' = 'pediu_remarcar',
  'NÃO pede para remarcar');
select pg_temp.check((select reschedule_requested_at is not null and status = 'agendado' from public.appointments where id = :'ap_paula2'), 'agendamento marcado para remarcar');
select pg_temp.check(exists (select 1 from public.notifications where kind = 'remarcar' and link like '%' || :'ap_paula2'), 'recepção é avisada');
select pg_temp.check(exists (select 1 from public.message_queue where appointment_id = :'ap_paula2' and kind = 'resposta' and status = 'pendente'), 'cliente recebe o link para remarcar');
select pg_temp.check((select stage from public.leads where id = :'lead_paula') = 'follow_up', 'card vai para follow-up');

-- Falhas: 3 tentativas e desiste
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.send_whatsapp_message(:'sa', '5511955554444', 'Teste de falha') as msg_falha \gset
select pg_temp.as_postgres();
update public.message_queue set status = 'enviando', attempts = attempts + 1, claimed_at = now() where id = :'msg_falha';
select public.report_whatsapp_result(:'msg_falha', false, null, 'Número sem WhatsApp');
select pg_temp.check((select status = 'pendente' and attempts = 1 and scheduled_for > now() from public.message_queue where id = :'msg_falha'), 'primeira falha volta para a fila mais tarde');
update public.message_queue set status = 'enviando', attempts = attempts + 1, claimed_at = now() where id = :'msg_falha';
select public.report_whatsapp_result(:'msg_falha', false, null, 'Número sem WhatsApp');
update public.message_queue set status = 'enviando', attempts = attempts + 1, claimed_at = now() where id = :'msg_falha';
select public.report_whatsapp_result(:'msg_falha', false, null, 'Número sem WhatsApp');
select pg_temp.check((select status = 'falhou' and attempts = 3 from public.message_queue where id = :'msg_falha'), 'terceira falha encerra');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.retry_queued_message(:'msg_falha');
select pg_temp.check((select status = 'pendente' and attempts = 0 from public.message_queue where id = :'msg_falha'), 'recepção pode reenviar');
select public.cancel_queued_message(:'msg_falha');

-- Janela e limite diário
select public.send_whatsapp_message(:'sa', '5511955553333', 'Fora da janela');
select pg_temp.as_postgres();
update public.salons set wa_window_start = '08:00', wa_window_end = '09:00' where id = :'sa';
select pg_temp.as_service();
select pg_temp.check((select count(*) from public.claim_whatsapp_messages((current_date + time '22:00') at time zone :'tz', 50)) = 0, 'fora da janela não envia');
select pg_temp.as_postgres();
update public.salons set wa_window_start = '00:00', wa_window_end = '23:59',
  wa_daily_limit = (select count(*) from public.message_queue where salon_id = :'sa' and status = 'enviada'
                    and claimed_at >= (date_trunc('day', now() at time zone :'tz') at time zone :'tz')) where id = :'sa';
select pg_temp.as_service();
select pg_temp.check((select count(*) from public.claim_whatsapp_messages(now(), 50)) = 0, 'limite diário segura a fila');
select pg_temp.as_postgres();
update public.salons set wa_daily_limit = 150 where id = :'sa';

-- ---------------------------------------------------------------------
-- Opt-out por palavra-chave
-- ---------------------------------------------------------------------
select pg_temp.as_service();
select pg_temp.check(public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-005', '5511955553333', 'Ze', 'PARAR') ->> 'action' = 'opt_out', 'PARAR entra no opt-out');
select pg_temp.check((select status from public.message_queue where phone = '5511955553333' and kind = 'manual') = 'ignorada', 'mensagem pendente para quem saiu é ignorada');
select pg_temp.check(exists (select 1 from public.message_queue where phone = '5511955553333' and kind = 'resposta'), 'quem saiu recebe a confirmação de saída');
select pg_temp.check(public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-006', '5511912345678', 'Paula', 'sair') ->> 'action' = 'opt_out', 'sair minúsculo também vale');
select pg_temp.check((select opt_out from public.clients where id = :'cli_paula'), 'cliente fica com opt-out');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.expect_error(format($q$select public.send_whatsapp_message(%L, '5511912345678', 'oi')$q$, :'sa'), 'OPT_OUT%');
update public.clients set opt_out = false where id = :'cli_paula';
select pg_temp.check(not exists (select 1 from public.opt_outs where salon_id = :'sa' and phone = '5511912345678'), 'tirar o opt-out na ficha libera o número');

-- ---------------------------------------------------------------------
-- Automações por tempo
-- ---------------------------------------------------------------------
select pg_temp.as_postgres();
insert into public.clients (salon_id, name, phone, birth_date) values
  (:'sa', 'Carol Teste', '5511944443333', (now() at time zone :'tz')::date - interval '30 years') returning id as cli_carol \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.create_appointment(:'sa', :'cli_carol', jsonb_build_array(jsonb_build_object(
  'service_id', :'escova', 'professional_id', :'bia', 'starts_at', :'em_4d', 'is_squeeze', true))) as ap_carol \gset
select pg_temp.as_service();
select public.run_automations(:'em_4d'::timestamptz - interval '23 hours');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_carol' and kind = 'lembrete_24h') = 1, 'lembrete 24h entra na fila');
select public.run_automations(:'em_4d'::timestamptz - interval '22 hours');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_carol' and kind = 'lembrete_24h') = 1, 'lembrete não duplica');
select public.run_automations(:'em_4d'::timestamptz - interval '90 minutes');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_carol' and kind = 'confirmacao_2h') = 1, 'confirmação 2h antes de quem não confirmou');
select public.run_automations(((now() at time zone :'tz')::date + time '10:00') at time zone :'tz');
select pg_temp.check(exists (select 1 from public.message_queue where client_id = :'cli_carol' and kind = 'aniversario'), 'aniversário de hoje entra na fila');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.set_appointment_status(:'ap_carol', 'cancelado', 'cliente desistiu');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_carol' and kind in ('lembrete_24h', 'confirmacao_2h') and status = 'cancelada') = 2,
  'cancelar tira os lembretes da fila');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_carol' and kind = 'cancelamento') = 1, 'aviso de cancelamento');

-- Automação desligada não enfileira
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.automations set enabled = false where salon_id = :'sa' and kind = 'confirmacao_agendamento';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
update public.automations set enabled = true where salon_id = :'sa' and kind = 'confirmacao_agendamento';
select public.create_appointment(:'sa', :'cli_carol', jsonb_build_array(jsonb_build_object(
  'service_id', :'escova', 'professional_id', :'bia', 'starts_at', :'em_3d', 'is_squeeze', true))) as ap_carol2 \gset
select pg_temp.check(not exists (select 1 from public.message_queue where appointment_id = :'ap_carol2'), 'automação desligada não envia (e a recepção não religa)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.automations set enabled = true where salon_id = :'sa' and kind = 'confirmacao_agendamento';

-- Falta: recuperação 2h depois, a não ser que já tenha remarcado
select pg_temp.as_postgres();
insert into public.clients (salon_id, name, phone) values (:'sa', 'Duda Falta', '5511933332222') returning id as cli_duda \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.create_appointment(:'sa', :'cli_duda', jsonb_build_array(jsonb_build_object(
  'service_id', :'mani', 'professional_id', :'bia', 'starts_at', now() - interval '3 hours', 'is_squeeze', true))) as ap_duda \gset
select public.set_appointment_status(:'ap_duda', 'nao_compareceu');
select pg_temp.as_service();
select public.run_automations(now() + interval '1 hour');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_duda' and kind = 'recuperacao_falta') = 0, 'não envia antes de 2h');
select public.run_automations(now() + interval '2 hours 5 minutes');
select pg_temp.check((select count(*) from public.message_queue where appointment_id = :'ap_duda' and kind = 'recuperacao_falta') = 1, 'recuperação de falta 2h depois');

-- Pós-atendimento e nota
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select public.create_appointment(:'sa', :'cli_duda', jsonb_build_array(jsonb_build_object(
  'service_id', :'mani', 'professional_id', :'bia', 'starts_at', ((now() at time zone :'tz')::date + time '00:05') at time zone :'tz', 'is_squeeze', true))) as ap_duda2 \gset
select public.set_appointment_status(:'ap_duda2', 'concluido');
select pg_temp.as_service();
select (((now() at time zone :'tz')::date + 1 + time '11:00') at time zone :'tz') as amanha_11 \gset
select public.run_automations(:'amanha_11');
select pg_temp.check((select count(*) from public.message_queue where client_id = :'cli_duda' and kind = 'pos_atendimento') = 1, 'pós-atendimento no dia seguinte');
select pg_temp.dispatch(:'amanha_11');
select pg_temp.check(public.whatsapp_inbound(:'sa', :'secret', 'INST3A2B1C', 'msg-007', '5511933332222', 'Duda', '10') ->> 'action' = 'nota', 'nota registrada');
select pg_temp.check((select score from public.client_feedback where client_id = :'cli_duda') = 10, 'nota 10 salva');
select pg_temp.check(exists (select 1 from public.message_queue where client_id = :'cli_duda' and kind = 'avaliacao_google'), 'nota 9-10 recebe pedido de avaliação no Google');

-- Reativação respeita o limite por dia
select public.run_automations(now());
select pg_temp.check((select count(*) from public.message_queue where salon_id = :'sa' and kind = 'reativacao') between 1 and 5, 'reativação até 5 por dia');
select public.run_automations(now());
select pg_temp.check((select count(*) from public.message_queue where salon_id = :'sa' and kind = 'reativacao') <= 5, 'reativação não passa do limite');

-- ---------------------------------------------------------------------
-- Campanha
-- ---------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select count(*) as aud from public.campaign_audience(:'sa', 'reativar', 60) \gset
select pg_temp.check(:aud > 0, 'público "para reativar"');
select public.create_campaign(:'sa', 'Teste', 'Oi, {nome}! Saudade de você no {salao}.',
  (select array_agg(client_id) from public.campaign_audience(:'sa', 'reativar', 60)), 'reativar') as camp \gset
select pg_temp.check((select recipients_count from public.campaigns where id = :'camp') = :aud, 'campanha vai para o público todo');
select pg_temp.check((select bool_and(body like 'Oi, %! Saudade de você no Studio Bela Flor.') from public.message_queue where campaign_id = :'camp'), 'campanha personalizada');
select pg_temp.check(not exists (select 1 from public.message_queue q join public.opt_outs o on o.salon_id = q.salon_id and public.phone_key(o.phone) = public.phone_key(q.phone)
  where q.campaign_id = :'camp'), 'campanha pula quem pediu para sair');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.expect_error(format($q$select public.create_campaign(%L, 'x', 'mensagem', array[%L]::uuid[])$q$, :'sa', :'cli_duda'), '42501');

-- ---------------------------------------------------------------------
-- Agendamento online (visitante anônimo)
-- ---------------------------------------------------------------------
select pg_temp.as_anon();
select pg_temp.check((select jsonb_array_length(public.public_booking_salon('studio-bela-flor') -> 'services')) >= 10, 'vitrine mostra os serviços');
select pg_temp.check((select jsonb_array_length(public.public_booking_salon('studio-bela-flor') -> 'professionals')) = 3, 'vitrine mostra as profissionais');
select pg_temp.check(public.public_booking_salon('nao-existe') is null, 'slug inexistente');
select pg_temp.check((select count(*) from public.leads) = 0, 'anônimo não lê o CRM');
select d as dia_online from generate_series(current_date + 9, current_date + 16, interval '1 day') d
 where extract(isodow from d) between 2 and 6 limit 1 \gset
select count(*) as nslots from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], null, :'dia_online') \gset
select pg_temp.check(:nslots > 10, 'horários livres para manicure');
select pg_temp.check((select count(*) from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], null, current_date - 1)) = 0, 'sem horários no passado');
select pg_temp.check((select count(*) from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], null, current_date + 60)) = 0, 'sem horários além do limite de dias');
select starts_at as slot1, professional_id as slot1_pro
  from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], null, :'dia_online') order by starts_at limit 1 \gset
select public.public_book_appointment('studio-bela-flor', array[:'mani']::uuid[], null, :'slot1', 'Visitante Online', '(21) 99876-5432', 'Primeira vez') as booking \gset
select pg_temp.check(:'booking'::jsonb ->> 'professional_name' is not null, 'reserva feita pelo link');
select pg_temp.expect_error(format($q$select public.public_book_appointment('studio-bela-flor', array[%L]::uuid[], %L, %L, 'Outra Pessoa', '21988887777')$q$,
  :'mani', :'slot1_pro', :'slot1'), 'HORARIO_INDISPONIVEL%');
select pg_temp.expect_error(format($q$select public.public_book_appointment('studio-bela-flor', array[%L]::uuid[], null, %L, 'Fulana', '123')$q$,
  :'mani', :'slot1'), '%WhatsApp válido%');
select pg_temp.check(not exists (select 1 from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], :'slot1_pro', :'dia_online') where starts_at = :'slot1'),
  'horário reservado sai da lista');
select pg_temp.as_postgres();
select (:'booking'::jsonb ->> 'appointment_id') as ap_online \gset
select pg_temp.check((select a.origin = 'link_online' and c.origin = 'link_online' and c.phone = '5521998765432' and a.notes = 'Primeira vez'
  from public.appointments a join public.clients c on c.id = a.client_id where a.id = :'ap_online'), 'agendamento e cliente com origem "Link online"');
select pg_temp.check((select l.stage = 'agendado' and l.origin = 'link_online' from public.leads l join public.appointments a on a.client_id = l.client_id where a.id = :'ap_online'),
  'cliente nova do link entra no CRM em "Agendado"');
select pg_temp.check(exists (select 1 from public.message_queue where appointment_id = :'ap_online' and kind = 'confirmacao_agendamento'), 'confirmação por WhatsApp na fila');
select pg_temp.check(exists (select 1 from public.notifications where kind = 'agendamento_online' and link like '%' || :'ap_online'), 'recepção é avisada da reserva');
select pg_temp.check((select body from public.message_queue where appointment_id = :'ap_online' and kind = 'confirmacao_agendamento') like '%Manicure%',
  'confirmação cita o serviço');

select pg_temp.as_anon();
select starts_at as slot2 from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], null, :'dia_online') order by starts_at offset 4 limit 1 \gset
select starts_at as slot3 from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], null, :'dia_online') order by starts_at offset 8 limit 1 \gset
select starts_at as slot4 from public.public_booking_slots('studio-bela-flor', array[:'mani']::uuid[], null, :'dia_online') order by starts_at offset 12 limit 1 \gset
select public.public_book_appointment('studio-bela-flor', array[:'mani']::uuid[], null, :'slot2', 'Visitante Online', '21998765432');
select public.public_book_appointment('studio-bela-flor', array[:'mani']::uuid[], null, :'slot3', 'Visitante Online', '21998765432');
select pg_temp.expect_error(format($q$select public.public_book_appointment('studio-bela-flor', array[%L]::uuid[], null, %L, 'Visitante Online', '21998765432')$q$,
  :'mani', :'slot4'), 'LIMITE%');
select pg_temp.as_postgres();
select pg_temp.check((select count(*) from public.clients where salon_id = :'sa' and phone = '5521998765432') = 1, 'mesmo telefone reaproveita a cliente');
update public.salons set online_booking_enabled = false where id = :'sb';
select pg_temp.as_anon();
select pg_temp.check(public.public_booking_salon('barbearia-do-ze') is null, 'salão com link desligado');

-- ---------------------------------------------------------------------
-- Notificações
-- ---------------------------------------------------------------------
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) from public.notifications where kind = 'nota_baixa') = 0, 'nota baixa só para o admin');
select public.mark_notifications_read(:'sa');
select pg_temp.check((select count(*) from public.notifications n where not exists (
  select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())) = 0, 'marcar tudo como lido');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) from public.notifications n where not exists (
  select 1 from public.notification_reads r where r.notification_id = n.id and r.user_id = auth.uid())) > 0, 'leitura é por pessoa');

select pg_temp.as_postgres();
