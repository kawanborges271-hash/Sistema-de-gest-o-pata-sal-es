# Salon OS

Sistema de gestão para salões de beleza: agenda, clientes, comandas, caixa, estoque, comissões, CRM e WhatsApp.
Multi-tenant (vários salões numa instalação), com permissões garantidas no banco.

**Stack:** React + TypeScript + Vite + Tailwind + shadcn/ui · Supabase (Auth, Postgres com RLS, Edge Functions, Storage).
Interface em português do Brasil, moeda R$, datas dd/mm/aaaa e horários sempre no fuso do salão.

## O que já existe (Fase 1)

| Área | O que faz |
|---|---|
| Cadastro e onboarding | Conta, criação do salão (nome, WhatsApp, endereço, horário), convite de equipe e opção de carregar um salão de demonstração. |
| Equipe | Convite por e-mail (vale 7 dias), papéis por salão: **admin**, **recepção**, **profissional**. Troca de papel, desativação, reenvio e cancelamento de convite. |
| Serviços | Catálogo por categoria com duração, preço (ou "a partir de"), intervalo de retorno, comissão padrão. Inativar em vez de apagar. |
| Profissionais | Serviços que faz (com preço/duração/comissão próprios opcionais), jornada por dia com intervalos, cor no calendário, login opcional. |
| Agenda | Visões Dia (colunas por profissional), Semana, Mês e Lista; contadores por status; vários serviços em sequência com troca de profissional; clicar no horário livre agenda; arrastar remarca; encaixe; bloqueios; lista de espera com sugestão automática quando um horário é liberado. |
| Clientes | Status automático (novo, agendado, ativo, em risco, inativo, perdido), último atendimento, total gasto, frequência, próximo retorno ("hora de retocar"); ficha técnica (fórmula de coloração, alergias), fotos antes/depois com consentimento; arquivar em vez de apagar. |
| Busca global | Ctrl+K para clientes, próximos agendamentos e serviços. |

## Fase 2: dinheiro, estoque e comissões

| Área | O que faz |
|---|---|
| Comandas | Abre pelo agendamento (traz os serviços e já usa a sessão de pacote da cliente) ou avulsa no balcão. Lança serviços, produtos e pacotes, ajusta preço "a partir de", desconto por item e na comanda. Recebe em várias formas ao mesmo tempo, com parcelas no crédito e troco no dinheiro. |
| Caixa | Abertura com troco, suprimento, sangria e despesa, total por forma de pagamento, taxas das maquininhas, fechamento com valor contado e a diferença registrada. Histórico de caixas. |
| Estoque | Produtos de revenda e de uso interno, controlados em un, ml ou g. Venda e consumo dos serviços (ex.: 60 g de tinta por coloração) baixam sozinhos quando a comanda é paga. Entrada, contagem e perda; alerta de mínimo. |
| Pacotes | Catálogo (ex.: 4 escovas por R$ 240, com validade), venda na comanda, saldo por cliente e uso de sessão sem cobrar de novo. |
| Comissões | Calculadas no pagamento da comanda: % do profissional para o serviço, senão o padrão do profissional, senão o do serviço; produto usa o % do produto. Sobre o bruto (menos descontos) ou o líquido (menos taxa da maquininha e/ou custo dos produtos usados), conforme Configurações. Acerto por período, com opção de tirar do caixa. |
| Configurações | Formas de pagamento com taxa, parcelas e taxa por parcela. |

## Fase 3: CRM, WhatsApp e agendamento online

| Área | O que faz |
|---|---|
| CRM | Kanban com Novo lead → Em contato → Agendado → Follow-up → Cliente → Não compareceu → Base fria → Perdido (Perdido pede o motivo). Arrastar entre colunas, próximo follow-up, conversa do WhatsApp dentro do card e histórico de etapas. KPIs: leads em andamento, follow-ups atrasados e conversão em 30 dias. Depois do primeiro agendamento o card anda sozinho com a agenda (agendou, concluiu, faltou, cancelou). |
| WhatsApp (Z-API) | Em Configurações: ID da instância, token (nunca volta para a tela, só os 4 últimos dígitos), Client-Token, QR Code, verificação da conexão, teste de envio e a URL do webhook com chave secreta (mascarada, com copiar e "gerar nova chave"). Mensagem de outra instância é recusada. Número novo vira lead com origem WhatsApp; número conhecido atualiza o card. |
| Automações | 12 mensagens com texto editável, variáveis, liga/desliga e "o que acontece depois": confirmação ao agendar, lembrete 24h, confirmação 2h (SIM confirma, NÃO marca "pediu para remarcar", avisa a recepção e manda o link), remarcação, cancelamento, pós-atendimento com nota 0–10 (9–10 pede avaliação no Google, até 6 avisa o dono), hora de retocar, recuperação de falta (não sai se já remarcou), aniversário com cupom, reativação (60 dias, X por dia, quem mais gastou primeiro) e pacote acabando. |
| Regras de envio | Janela de horário, limite por dia, intervalo entre mensagens, 3 tentativas e opt-out por SAIR/PARAR/STOP. Painel com enviadas hoje, fila e falhas em 7 dias; fila em Próximos/Enviadas/Não enviadas; campanhas com públicos prontos; lista de opt-out; notas do pós-atendimento (média e NPS). |
| Agendamento online | `/agendar/<slug>`, sem login e pensado para celular: serviços → profissional ou "qualquer um" → dia e horários livres de verdade (jornada, bloqueios, agenda) → nome e WhatsApp. Entra com origem "Link online", cria o lead, avisa no sino e dispara a confirmação. Limite de 3 horários futuros por telefone e 40 reservas por hora por salão. |
| Sino | Lead novo, reserva pelo link, pedido de remarcação e nota baixa, com "marcar todas como lidas". |

Clientes da demonstração ficam com `is_demo`: mesmo com a Z-API ligada, nada sai para eles.

## Fase 4: dashboard, marketing, inteligência e fidelidade

Telas só do administrador, exceto Fidelidade (recepção vê saldos e resgata na comanda).

| Área | O que faz |
|---|---|
| Dashboard | Faturamento (card preto), comandas fechadas, ticket médio, agendamentos, comparecimento (compareceram ÷ (compareceram + faltaram)), ocupação da agenda (horas agendadas ÷ horas disponíveis), clientes novos, clientes que voltaram, venda de produtos (% do faturamento) e comissões. Cada card mostra a fórmula e a variação contra o período anterior do mesmo tamanho. Gráfico por dia (por semana acima de 62 dias) com o período anterior ao lado, próximos agendamentos e aniversariantes da semana. Períodos: 7, 30, 90 dias, este mês ou datas livres. |
| Marketing & Vendas | Lançamento mensal por canal (Meta Ads, Google, Instagram orgânico, indicação). Leads, agendamentos, vendas e receita vêm sozinhos da origem da cliente e podem ser corrigidos à mão. ROI ((receita − investimento) ÷ investimento), CPL, custo por agendamento, ticket médio, lead → venda, funil do mês e evolução de 12 meses. Mês sem lançamento aparece como "—". |
| Inteligência | Plano de ação numerado por valor estimado (leads parados há mais de 3 dias, follow-ups atrasados, hora de retocar, vieram e não voltaram, para reativar, pacotes acabando, dia vazio nos próximos 7 dias, faltas altas), cada um com a próxima ação. Listas com "Criar campanha" que já abre a fila do WhatsApp com o público certo. Serviços que mais faturam, faltas por dia da semana, mapa de calor de ocupação por dia e hora e desempenho por profissional (agendados, comparecimento, faturamento, ticket, retorno das clientes, produtos). Amostra menor que 3 aparece como "poucos". |
| Fidelidade | Pontos por real pago (configurável), prêmios em serviços resgatados direto na comanda (com "desfazer"), programa de indicação: quem indica ganha crédito quando a indicada paga a primeira comanda, e usa o crédito como forma de pagamento. Extrato por cliente, ajuste manual com motivo obrigatório. Cancelar a comanda devolve pontos, resgate e crédito. |

## Fase 5: Painel SaaS (super admin)

Em `/painel`, só para quem está em `platform_admins`. O super admin não é membro dos salões: ele não vê agenda,
clientes nem nenhum valor em reais, só contagens.

| Área | O que faz |
|---|---|
| Salões | Lista com plano, equipe, clientes, agendamentos e leads dos últimos 30 dias, mensagens do mês contra o limite, WhatsApp conectado, último acesso e última atividade. Abrir um salão mostra o uso, troca o plano, lista a equipe (com "Mover") e suspende ou reativa (motivo obrigatório). |
| Novo salão | Nome, e-mail da dona, plano e fuso. Se o e-mail já tem conta, ela vira administradora na hora; se não, sai um link de convite de administradora. |
| Usuários | Busca por nome ou e-mail, mostra os salões de cada pessoa e move ou dá acesso a outro salão com o papel escolhido. O último administrador de um salão não sai. |
| Planos | Básico (3 profissionais, 1.000 mensagens/mês) e Pro (15, 10.000), editáveis; em branco é sem limite. |
| Histórico | Tudo o que o suporte fez: salão criado, plano, suspensão, mudanças de usuários e de limites. |

Limites do plano valem no banco: o 4º profissional ativo do Básico é recusado (`LIMITE_PLANO`) e mensagens acima
do limite do mês ficam na fila até o mês virar, com um aviso por mês para o administrador. O salão vê o próprio uso
em Configurações → Plano. A equipe de um salão suspenso vê uma tela explicando a suspensão.

Para tornar alguém super admin (no SQL Editor, depois que a pessoa criou a conta):

```sql
insert into public.platform_admins (user_id) select id from auth.users where email = 'suporte@seudominio.com';
```

## Regras garantidas no banco

- **RLS em todas as tabelas.** Cada linha tem `salon_id`; só membros ativos do salão leem/escrevem, e o papel é checado na policy.
  - Profissional vê só os próprios itens de agenda e só clientes que atendeu ou tem marcados.
  - Recepção agenda e cadastra clientes, mas não altera catálogo, equipe ou configurações.
- **Sem sobreposição:** `EXCLUDE USING gist` por profissional em `appointment_items` (encaixe é a exceção explícita).
- **Jornada, intervalos e bloqueios** validados por trigger; o erro volta com prefixo (`FORA_DA_JORNADA`, `BLOQUEIO`) para a tela oferecer encaixe.
- **Remarcar** gera um novo agendamento e deixa o original como "Reagendado".
- **Nada é apagado:** serviços e profissionais inativam, clientes arquivam, agendamentos cancelam.
- **Auditoria:** `audit_log` registra toda mudança em agendamentos e itens.
- **Fotos** só com consentimento registrado, em bucket privado (`client-photos`) com policy por salão.
- Salão suspenso (`salons.suspended_at`) perde o acesso a tudo.
- **Fechamento da comanda numa transação só** (`close_order`): pagamentos no caixa aberto, baixa de estoque,
  pacotes, comissões e conclusão do agendamento. A soma dos pagamentos tem que bater com o total.
- **Comanda paga não se edita.** Cancelar uma comanda paga é só do admin e desfaz tudo: dinheiro sai da gaveta,
  estoque volta, sessões de pacote voltam e a comissão vira estorno (se já foi paga, entra negativa no próximo acerto).
- **Estoque, pagamentos e comissões só mudam pelas funções** do banco; o saldo do produto não é editável direto.
- Recepção opera comandas, caixa e entradas de estoque, mas não vê comissões; profissional vê só as próprias comissões.
- **Extrato de fidelidade só cresce:** pontos e crédito só mudam pelas funções e gatilhos; estorno e ajuste entram como
  novo movimento. Saldo não fica negativo, item resgatado não muda de preço e o crédito pago na comanda não gera pontos.
- **Plano e suspensão** só mudam pelo super admin (gatilho em `salons`); toda ação do painel vai para `platform_audit`.
- Dashboard, Marketing e Inteligência são calculados no banco (`dashboard_summary`, `marketing_report`,
  `intelligence_report`, `intelligence_actions`) no fuso do salão e só respondem ao administrador.

## Como rodar

### 1. Supabase

```bash
npm i -g supabase            # ou use npx supabase
supabase link --project-ref SEU_REF
supabase db push             # aplica supabase/migrations
supabase functions deploy team-invite
supabase secrets set APP_URL=https://seu-dominio.com
```

#### WhatsApp (Fase 3)

```bash
supabase functions deploy whatsapp-webhook whatsapp-dispatch whatsapp-connect
supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
```

`whatsapp-webhook` e `whatsapp-dispatch` rodam com `verify_jwt = false` (já em `supabase/config.toml`): o webhook
é protegido pela chave secreta na URL e pela instância, o disparo pelo header `x-cron-secret`. `whatsapp-connect`
exige o login de um admin do salão. A service role só existe dentro das funções.

O banco roda `run_automations()` a cada 5 minutos com pg_cron (ligue as extensões **pg_cron** e **pg_net** em
Database → Extensions). Para o disparo, agende a função a cada minuto no SQL Editor:

```sql
select cron.schedule('whatsapp-dispatch', '* * * * *', $$
  select net.http_post(
    url := 'https://SEU_REF.supabase.co/functions/v1/whatsapp-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'O_MESMO_CRON_SECRET')
  )
$$);
```

Depois, em Configurações → WhatsApp: salve o ID da instância e o token da Z-API, leia o QR Code, clique em
"Configurar webhook na Z-API" e envie um teste. Para testar sem Z-API real, `ZAPI_BASE_URL` aponta as funções
para um servidor falso.

No painel do Supabase, em Authentication → URL Configuration, coloque a URL do app em *Site URL* e
`https://seu-dominio.com/**` em *Redirect URLs* (o convite redireciona para `/convite/<token>`).

### 2. Front-end

```bash
cp .env.example .env.local   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev                  # http://localhost:8080
```

Crie a conta, siga o onboarding e escolha **Explorar com dados de exemplo** para ver a agenda cheia
(3 profissionais, 15 serviços, 30 clientes e 6 semanas de atendimentos, com as comandas pagas,
um caixa por dia, estoque, pacotes e comissões; o caixa de hoje já fica aberto).

## Testes

```bash
npm test                     # testes de fuso, formatação e erros (vitest)
npm run lint
npm run build

# Testes do banco: aplica as migrations num Postgres 15+ vazio e roda supabase/tests/*.sql
PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
```

Os testes SQL cobrem isolamento entre salões, permissões por papel, convites (e-mail errado, expirado, já usado),
sobreposição, encaixe, jornada, bloqueio, cancelamento liberando horário, remarcação, lista de espera,
consentimento de fotos, storage por salão, último admin e salão suspenso. Os da Fase 2 (`20_phase2.sql`) cobrem
caixa fechado, pagamento que não bate, parcelas, taxa, baixa de estoque, comissões (bruto, líquido, desconto, pacote),
estorno de comanda paga, acerto de comissão, diferença no fechamento do caixa e o que cada papel pode ver.
Os da Fase 3 (`30_phase3.sql`) cobrem segredo e instância do webhook, lead novo e conhecido, SIM/NÃO, nota 0–10,
opt-out, janela, limite diário, espaçamento, 3 tentativas, cada automação (inclusive "não envia se já remarcou"),
campanhas, o card andando com a agenda, horários livres e limites do agendamento online, e o que o anônimo e cada
papel conseguem ver (o token da Z-API nunca sai do banco).
Os da Fase 4 (`40_phase4.sql`) cobrem cada indicador do dashboard e o período anterior, ocupação com bloqueio,
gráfico por semana, marketing com e sem lançamento e correção manual, os novos públicos, o plano de ação,
pontos, resgate e desfazer, crédito de indicação (uma vez por indicada), cancelamento devolvendo tudo,
ajuste com motivo e quem pode ver o quê.
Os da Fase 5 (`50_phase5.sql`) cobrem quem acessa o painel, ausência de valores financeiros, limite de profissionais,
limite de mensagens com um aviso só, criar salão (conta existente e convite), suspender e reativar, mover e dar acesso
(sem tirar o último admin) e o histórico.

As Edge Functions são checadas com `deno check` e o parser da Z-API tem testes no vitest (`src/test/zapi.test.ts`).

## Estrutura

```
supabase/migrations/   001 tenancy · 002 catálogo · 003 clientes · 004 agenda · 005 demonstração
                       006 estoque e pacotes · 007 comandas, caixa e comissões · 008 demonstração da Fase 2
                       009 CRM e WhatsApp · 010 agendamento online · 011 demonstração da Fase 3
                       012 dashboard, marketing e inteligência · 013 fidelidade e indicação · 014 demonstração da Fase 4
                       015 painel SaaS, planos e limites
supabase/functions/    team-invite (convite por e-mail) · whatsapp-webhook · whatsapp-dispatch · whatsapp-connect
supabase/tests/        testes SQL + stub mínimo do ambiente Supabase
src/pages/             uma tela por rota
src/components/        agenda, clientes, serviços, profissionais, layout, comuns e shadcn/ui
src/hooks/             acesso a dados com React Query
src/lib/               fuso (tz.ts), formatação, rótulos e permissões
```
