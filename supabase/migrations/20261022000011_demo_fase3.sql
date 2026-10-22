-- =====================================================================
-- Salon OS · 011 · Demonstração da Fase 3
-- Leads em todas as etapas do CRM, conversas, histórico de mensagens
-- (lembretes, pós-atendimento com notas, uma campanha, falhas), um opt-out
-- e notificações. Os clientes da demonstração ficam marcados com is_demo:
-- mesmo com a Z-API ligada, nenhuma mensagem sai para eles.
-- =====================================================================

-- Demonstrações carregadas antes desta migração: clientes com e-mail
-- @exemplo.com e telefone gerado pelo seed também viram is_demo
update public.clients set is_demo = true
 where email like '%@exemplo.com' and phone ~ '^551198\d{7}$' and not is_demo;
update public.message_queue q set status = 'ignorada', last_error = 'Cliente de demonstração'
  from public.clients c
 where c.id = q.client_id and c.is_demo and q.status = 'pendente';

alter function public.seed_demo_salon(uuid) rename to seed_demo_salon_fase2;
revoke execute on function public.seed_demo_salon_fase2(uuid) from public, anon, authenticated;

create or replace function public.seed_demo_salon(p_salon_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_tz text;
  r record;
  v_id uuid;
  v_lead uuid;
  v_campaign uuid;
  v_score int;
  v_n int := 0;
  v_clients uuid[];
begin
  perform public.seed_demo_salon_fase2(p_salon_id);   -- checa admin e salão vazio
  -- dispara agora as confirmações adiadas dos agendamentos futuros criados acima
  set constraints all immediate;
  perform setseed(0.31);
  select timezone into v_tz from public.salons where id = p_salon_id;

  update public.clients set is_demo = true where salon_id = p_salon_id;
  -- as faltas da demonstração aconteceram no horário marcado, não agora
  update public.appointments set no_show_at = ends_at
   where salon_id = p_salon_id and status = 'nao_compareceu';
  -- confirmações das consultas futuras da demonstração já "saíram" há dias
  update public.message_queue set status = 'enviada', attempts = 1,
         sent_at = least(now(), (select a.created_at from public.appointments a where a.id = appointment_id) + interval '2 minutes'),
         claimed_at = least(now(), (select a.created_at from public.appointments a where a.id = appointment_id) + interval '2 minutes')
   where salon_id = p_salon_id and status = 'pendente' and kind = 'confirmacao_agendamento'
     and created_at > now() - interval '1 minute';

  update public.salons
     set google_review_url = coalesce(google_review_url, 'https://g.page/r/exemplo-salao/review')
   where id = p_salon_id;

  -- Lembretes 24h das últimas 2 semanas (enviados) e respostas SIM
  for r in
    select a.id, a.client_id, c.phone, a.starts_at, a.status
    from public.appointments a join public.clients c on c.id = a.client_id
    where a.salon_id = p_salon_id and a.starts_at between now() - interval '14 days' and now()
      and a.status in ('concluido', 'nao_compareceu')
  loop
    insert into public.message_queue (salon_id, client_id, appointment_id, phone, body, kind, status,
                                      scheduled_for, claimed_at, sent_at, attempts, dedupe_key, created_at)
    values (p_salon_id, r.client_id, r.id, r.phone,
            public.render_message((select template from public.automations where salon_id = p_salon_id and kind = 'lembrete_24h'),
                                  public.appointment_message_vars(r.id)),
            'lembrete_24h', 'enviada', r.starts_at - interval '24 hours', r.starts_at - interval '24 hours',
            r.starts_at - interval '24 hours' + interval '40 seconds', 1, 'lembrete_24h:' || r.id, r.starts_at - interval '24 hours')
    on conflict do nothing;
    insert into public.whatsapp_messages (salon_id, direction, phone, client_id, body, created_at)
    select p_salon_id, 'out', r.phone, r.client_id, q.body, q.sent_at
    from public.message_queue q where q.salon_id = p_salon_id and q.dedupe_key = 'lembrete_24h:' || r.id;
    if r.status = 'concluido' and random() < 0.7 then
      insert into public.whatsapp_messages (salon_id, direction, phone, client_id, body, created_at)
      values (p_salon_id, 'in', r.phone, r.client_id,
              (array['Sim', 'SIM', 'Sim, confirmado!', 'sim 😊', 'Confirmo'])[1 + floor(random() * 5)::int],
              r.starts_at - interval '23 hours');
    end if;
  end loop;

  -- Pós-atendimento dos últimos 7 dias, com notas
  for r in
    select distinct on (a.client_id, (a.starts_at at time zone v_tz)::date)
           a.id, a.client_id, c.phone, c.name, (a.starts_at at time zone v_tz)::date as day
    from public.appointments a join public.clients c on c.id = a.client_id
    where a.salon_id = p_salon_id and a.status = 'concluido'
      and a.starts_at between now() - interval '8 days' and now() - interval '1 day'
    order by a.client_id, (a.starts_at at time zone v_tz)::date, a.starts_at desc
  loop
    insert into public.message_queue (salon_id, client_id, appointment_id, phone, body, kind, status,
                                      scheduled_for, claimed_at, sent_at, attempts, dedupe_key, created_at)
    values (p_salon_id, r.client_id, r.id, r.phone,
            public.render_message((select template from public.automations where salon_id = p_salon_id and kind = 'pos_atendimento'),
                                  public.appointment_message_vars(r.id)),
            'pos_atendimento', 'enviada', (r.day + 1 + time '10:00') at time zone v_tz, (r.day + 1 + time '10:00') at time zone v_tz,
            (r.day + 1 + time '10:01') at time zone v_tz, 1, 'pos:' || r.client_id || ':' || r.day,
            (r.day + 1 + time '10:00') at time zone v_tz)
    on conflict do nothing;
    if random() < 0.65 then
      v_n := v_n + 1;
      v_score := case when v_n = 3 then 5 when random() < 0.75 then 9 + floor(random() * 2)::int else 7 + floor(random() * 2)::int end;
      insert into public.client_feedback (salon_id, client_id, appointment_id, score, created_at)
      values (p_salon_id, r.client_id, r.id, v_score, (r.day + 1 + time '11:20') at time zone v_tz)
      on conflict do nothing;
      insert into public.whatsapp_messages (salon_id, direction, phone, client_id, body, created_at)
      values (p_salon_id, 'in', r.phone, r.client_id, v_score::text, (r.day + 1 + time '11:20') at time zone v_tz);
      if v_score <= 6 then
        insert into public.notifications (salon_id, kind, title, body, link, roles, created_at)
        values (p_salon_id, 'nota_baixa', 'Nota ' || v_score || ' de ' || r.name,
                'Vale ligar para entender o que aconteceu no atendimento.', '/clientes/' || r.client_id, '{admin}',
                (r.day + 1 + time '11:20') at time zone v_tz);
      end if;
    end if;
  end loop;

  -- Uma campanha de reativação há 5 dias
  select array_agg(id) into v_clients from (
    select co.id from public.client_overview co
    where co.salon_id = p_salon_id and co.last_visit_at < now() - interval '60 days' and co.next_appointment_at is null
    order by co.total_spent desc nulls last limit 6
  ) x;
  if coalesce(cardinality(v_clients), 0) > 0 then
    insert into public.campaigns (salon_id, name, body, audience, scheduled_for, recipients_count, created_by, created_at)
    values (p_salon_id, 'Volta para o salão', 'Oi, {nome}! Estamos com saudade. Nesta semana, quem voltar ganha uma hidratação. Marque aqui: {link_agendamento}',
            'reativar', now() - interval '5 days', cardinality(v_clients), auth.uid(), now() - interval '5 days')
    returning id into v_campaign;
    insert into public.message_queue (salon_id, client_id, campaign_id, phone, body, kind, status,
                                      scheduled_for, claimed_at, sent_at, attempts, dedupe_key, created_at, last_error)
    select p_salon_id, c.id, v_campaign, c.phone,
           public.render_message((select body from public.campaigns where id = v_campaign), public.client_message_vars(c.id)),
           'campanha', case when n = 2 then 'falhou' else 'enviada' end,
           now() - interval '5 days', now() - interval '5 days' + n * interval '30 seconds',
           case when n = 2 then null else now() - interval '5 days' + n * interval '30 seconds' end,
           case when n = 2 then 3 else 1 end,
           'campanha:' || v_campaign || ':' || c.id, now() - interval '5 days',
           case when n = 2 then 'Número sem WhatsApp' end
    from public.clients c
    join lateral (select array_position(v_clients, c.id) as n) p on true
    where c.id = any(v_clients);
  end if;

  -- Um opt-out por palavra-chave
  select c.id, c.phone, c.name into r from public.clients c
   where c.salon_id = p_salon_id order by c.created_at desc offset 3 limit 1;
  insert into public.whatsapp_messages (salon_id, direction, phone, client_id, body, created_at)
  values (p_salon_id, 'in', r.phone, r.id, 'SAIR', now() - interval '3 days');
  insert into public.opt_outs (salon_id, phone, reason, source_message, created_at)
  values (p_salon_id, r.phone, 'palavra_chave', 'SAIR', now() - interval '3 days');

  -- CRM: leads em todas as etapas
  insert into public.leads (salon_id, name, phone, origin, stage, interest, last_message, last_message_at, last_message_direction, created_at)
  values
    (p_salon_id, 'Renata Prado', '5511987650101', 'whatsapp', 'novo', 'Progressiva',
     'Oi! Quanto está a progressiva? Meu cabelo é bem comprido.', now() - interval '35 minutes', 'in', now() - interval '35 minutes'),
    (p_salon_id, 'Kelly Andrade', '5511987650102', 'instagram', 'novo', 'Unhas em gel',
     'Vi no Instagram o alongamento, vocês têm horário sábado?', now() - interval '3 hours', 'in', now() - interval '3 hours'),
    (p_salon_id, 'Priscila Mota', '5511987650103', 'meta_ads', 'novo', 'Mechas',
     'Quero fazer mechas, pode me mandar valores?', now() - interval '26 hours', 'in', now() - interval '26 hours'),
    (p_salon_id, 'Aline Campos', '5511987650104', 'whatsapp', 'em_contato', 'Coloração',
     'Vou ver com meu marido e te falo!', now() - interval '2 days', 'in', now() - interval '4 days'),
    (p_salon_id, 'Luana Torres', '5511987650105', 'google', 'em_contato', 'Design de sobrancelha',
     'Temos horário quinta às 15h ou sexta às 10h. Qual fica melhor?', now() - interval '5 days', 'out', now() - interval '6 days'),
    (p_salon_id, 'Marina Lopes', '5511987650106', 'indicacao', 'follow_up', 'Mechas + corte',
     'Me chama semana que vem que eu recebo o salário 😅', now() - interval '6 days', 'in', now() - interval '9 days'),
    (p_salon_id, 'Joana Freitas', '5511987650107', 'meta_ads', 'base_fria', 'Progressiva',
     'Achei um pouco caro, vou pensar.', now() - interval '40 days', 'in', now() - interval '45 days');
  update public.leads set next_follow_up_at = now() - interval '1 day'
   where salon_id = p_salon_id and phone = '5511987650105';
  update public.leads set next_follow_up_at = now() + interval '2 days'
   where salon_id = p_salon_id and phone = '5511987650106';
  update public.leads set stage = 'perdido', lost_reason = 'Achou caro'
   where salon_id = p_salon_id and phone = '5511987650107';
  insert into public.leads (salon_id, name, phone, origin, stage, interest, last_message, last_message_at, last_message_direction, created_at)
  values (p_salon_id, 'Sofia Rezende', '5511987650108', 'instagram', 'base_fria', 'Maquiagem para casamento',
          'Obrigada! Quando tiver a data eu volto a falar.', now() - interval '38 days', 'in', now() - interval '42 days');

  -- Leads que viraram clientes: as clientes novas da demonstração (26 a 30)
  -- e duas clientes que vieram do Instagram e já são da casa
  for r in
    select * from (
      select c.id, c.name, c.phone, c.origin,
             exists (select 1 from public.appointments a where a.client_id = c.id and a.status in ('agendado', 'confirmado')) as booked,
             exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'concluido') as came
      from public.clients c
      where c.salon_id = p_salon_id
      order by c.created_at desc limit 4
    ) recent
    union
    select * from (
      select c.id, c.name, c.phone, c.origin, false, true
      from public.clients c
      where c.salon_id = p_salon_id and c.origin in ('instagram', 'meta_ads')
        and exists (select 1 from public.appointments a where a.client_id = c.id and a.status = 'concluido')
      order by c.name limit 2
    ) regulars
  loop
    insert into public.leads (salon_id, client_id, name, phone, origin, stage, interest, last_message, last_message_at,
                              last_message_direction, created_at, converted_at)
    values (p_salon_id, r.id, r.name, r.phone, r.origin,
            (case when r.came then 'cliente' when r.booked then 'agendado' else 'em_contato' end)::public.lead_stage,
            null, 'Combinado, até lá!', now() - interval '2 days', 'in', now() - interval '8 days',
            case when r.came then now() - interval '3 days' end)
    on conflict do nothing;
  end loop;

  -- Conversas dos leads
  for r in select id, phone, name, interest, last_message, last_message_at, last_message_direction, created_at
           from public.leads where salon_id = p_salon_id loop
    insert into public.whatsapp_messages (salon_id, direction, phone, lead_id, client_id, body, sender_name, created_at)
    select p_salon_id, 'in', r.phone, r.id, (select client_id from public.leads where id = r.id),
           'Oi, tudo bem? Queria saber sobre ' || lower(coalesce(r.interest, 'os serviços')) || '.', r.name, r.created_at
    where r.last_message_at > r.created_at + interval '1 minute';
    insert into public.whatsapp_messages (salon_id, direction, phone, lead_id, client_id, body, created_at)
    select p_salon_id, 'out', r.phone, r.id, (select client_id from public.leads where id = r.id),
           'Oi, ' || public.first_name(r.name) || '! Tudo ótimo. Te passo os detalhes agora.', r.created_at + interval '12 minutes'
    where r.last_message_at > r.created_at + interval '30 minutes';
    insert into public.whatsapp_messages (salon_id, direction, phone, lead_id, client_id, body, sender_name, created_at)
    values (p_salon_id, r.last_message_direction, r.phone, r.id, (select client_id from public.leads where id = r.id),
            r.last_message, case when r.last_message_direction = 'in' then r.name end, r.last_message_at);
  end loop;

  -- Notificações recentes
  insert into public.notifications (salon_id, kind, title, body, link, created_at)
  select p_salon_id, 'novo_lead', 'Novo lead no WhatsApp: ' || l.name, l.last_message, '/crm?lead=' || l.id, l.created_at
  from public.leads l where l.salon_id = p_salon_id and l.stage = 'novo' and l.origin = 'whatsapp';
end $$;

revoke execute on function public.seed_demo_salon(uuid) from public, anon;
grant execute on function public.seed_demo_salon(uuid) to authenticated;
