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

As fases 2 a 5 (comandas e caixa, estoque, comissões, CRM, WhatsApp, dashboard, Painel SaaS) aparecem no menu como "Fase N".

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

## Como rodar

### 1. Supabase

```bash
npm i -g supabase            # ou use npx supabase
supabase link --project-ref SEU_REF
supabase db push             # aplica supabase/migrations
supabase functions deploy team-invite
supabase secrets set APP_URL=https://seu-dominio.com
```

No painel do Supabase, em Authentication → URL Configuration, coloque a URL do app em *Site URL* e
`https://seu-dominio.com/**` em *Redirect URLs* (o convite redireciona para `/convite/<token>`).

### 2. Front-end

```bash
cp .env.example .env.local   # preencha VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev                  # http://localhost:8080
```

Crie a conta, siga o onboarding e escolha **Explorar com dados de exemplo** para ver a agenda cheia
(3 profissionais, 15 serviços, 30 clientes e 6 semanas de atendimentos).

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
consentimento de fotos, storage por salão, último admin e salão suspenso.

## Estrutura

```
supabase/migrations/   001 tenancy · 002 catálogo · 003 clientes · 004 agenda · 005 demonstração
supabase/functions/    team-invite (convite por e-mail com a service role só no servidor)
supabase/tests/        testes SQL + stub mínimo do ambiente Supabase
src/pages/             uma tela por rota
src/components/        agenda, clientes, serviços, profissionais, layout, comuns e shadcn/ui
src/hooks/             acesso a dados com React Query
src/lib/               fuso (tz.ts), formatação, rótulos e permissões
```
