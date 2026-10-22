import type { AutomationKind, LeadStage, MessageKind, QueueStatus } from "./types";

export const LEAD_STAGES: LeadStage[] = [
  "novo", "em_contato", "agendado", "follow_up", "cliente", "nao_compareceu", "base_fria", "perdido",
];

export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  novo: "Novo lead",
  em_contato: "Em contato",
  agendado: "Agendado",
  follow_up: "Follow-up",
  cliente: "Cliente",
  nao_compareceu: "Não compareceu",
  base_fria: "Base fria",
  perdido: "Perdido",
};

/** Cor do ponto de cada coluna do funil */
export const LEAD_STAGE_DOT: Record<LeadStage, string> = {
  novo: "bg-copper",
  em_contato: "bg-sky-500",
  agendado: "bg-violet-500",
  follow_up: "bg-warning",
  cliente: "bg-success",
  nao_compareceu: "bg-destructive",
  base_fria: "bg-slate-400",
  perdido: "bg-foreground/40",
};

/** Etapas que contam como "em andamento" */
export const OPEN_STAGES: LeadStage[] = ["novo", "em_contato", "agendado", "follow_up", "nao_compareceu"];

export const LOST_REASONS = ["Achou caro", "Escolheu outro salão", "Sem horário que sirva", "Parou de responder", "Mora longe", "Outro"];

export const QUEUE_STATUS_LABEL: Record<QueueStatus, string> = {
  pendente: "Na fila",
  enviando: "Enviando",
  enviada: "Enviada",
  falhou: "Falhou",
  cancelada: "Cancelada",
  ignorada: "Não enviada",
  expirada: "Expirou",
};

export const QUEUE_STATUS_STYLE: Record<QueueStatus, string> = {
  pendente: "bg-accent text-accent-foreground",
  enviando: "bg-sky-100 text-sky-700",
  enviada: "bg-success/10 text-success",
  falhou: "bg-destructive/10 text-destructive",
  cancelada: "bg-muted text-muted-foreground",
  ignorada: "bg-muted text-muted-foreground",
  expirada: "bg-muted text-muted-foreground",
};

export type AutomationField = { key: string; label: string; type: "number" | "time" | "text"; suffix?: string; min?: number; max?: number };

export type AutomationMeta = {
  title: string;
  when: string;
  /** "o que acontece depois" */
  after: string;
  variables: string[];
  fields?: AutomationField[];
  group: "agenda" | "relacionamento";
};

const APPT_VARS = ["nome", "servico", "profissional", "data", "hora", "salao", "link_agendamento"];
const CLIENT_VARS = ["nome", "salao", "link_agendamento"];

export const AUTOMATION_ORDER: AutomationKind[] = [
  "confirmacao_agendamento", "lembrete_24h", "confirmacao_2h", "reagendamento", "cancelamento",
  "recuperacao_falta", "pos_atendimento", "avaliacao_google", "retoque", "aniversario", "reativacao", "pacote_acabando",
];

export const AUTOMATION_META: Record<AutomationKind, AutomationMeta> = {
  confirmacao_agendamento: {
    group: "agenda",
    title: "Confirmação ao agendar",
    when: "Assim que o horário é marcado (recepção, link online ou WhatsApp).",
    after: "SIM muda o agendamento para Confirmado. NÃO marca \"pediu para remarcar\", avisa a recepção no sino e manda o link para escolher outro horário.",
    variables: APPT_VARS,
  },
  lembrete_24h: {
    group: "agenda",
    title: "Lembrete antes do horário",
    when: "Algumas horas antes do atendimento (padrão: 24h).",
    after: "Mesmas respostas da confirmação: SIM confirma, NÃO pede para remarcar.",
    variables: APPT_VARS,
    fields: [{ key: "hours_before", label: "Enviar quantas horas antes", type: "number", suffix: "horas", min: 3, max: 72 }],
  },
  confirmacao_2h: {
    group: "agenda",
    title: "Confirmação no dia",
    when: "Pouco antes do horário, só para quem ainda não confirmou (padrão: 2h).",
    after: "SIM confirma; NÃO libera o horário para a recepção remarcar ou chamar a lista de espera.",
    variables: APPT_VARS,
    fields: [{ key: "hours_before", label: "Enviar quantas horas antes", type: "number", suffix: "horas", min: 1, max: 6 }],
  },
  reagendamento: {
    group: "agenda",
    title: "Horário remarcado",
    when: "Quando a recepção remarca um agendamento.",
    after: "O lembrete passa a valer para o novo horário.",
    variables: APPT_VARS,
  },
  cancelamento: {
    group: "agenda",
    title: "Horário cancelado",
    when: "Quando um agendamento futuro é cancelado.",
    after: "Lembretes pendentes desse horário saem da fila.",
    variables: APPT_VARS,
  },
  recuperacao_falta: {
    group: "agenda",
    title: "Recuperação de falta",
    when: "Algumas horas depois de marcar \"Não compareceu\" (padrão: 2h). Não envia se a cliente já remarcou.",
    after: "Se ela responder, o card do CRM volta para Em contato.",
    variables: APPT_VARS,
    fields: [{ key: "hours_after", label: "Enviar quantas horas depois", type: "number", suffix: "horas", min: 1, max: 12 }],
  },
  pos_atendimento: {
    group: "relacionamento",
    title: "Pós-atendimento com nota",
    when: "No dia seguinte ao atendimento, a partir do horário escolhido.",
    after: "A cliente responde de 0 a 10. Nota alta recebe o pedido de avaliação no Google; nota até 6 avisa o dono no sino.",
    variables: APPT_VARS,
    fields: [{ key: "hour", label: "Enviar a partir de", type: "time" }],
  },
  avaliacao_google: {
    group: "relacionamento",
    title: "Pedido de avaliação no Google",
    when: "Logo depois de uma nota alta no pós-atendimento.",
    after: "Só sai se o link de avaliação do Google estiver preenchido.",
    variables: ["nome", "salao", "link_avaliacao"],
    fields: [{ key: "min_score", label: "Nota mínima", type: "number", min: 7, max: 10 }],
  },
  retoque: {
    group: "relacionamento",
    title: "Hora de retocar",
    when: "Quando passa o intervalo de retorno do serviço (cadastrado em Serviços) e não há nada marcado.",
    after: "Se a cliente marcar pelo link, o agendamento entra com origem Link online.",
    variables: [...CLIENT_VARS, "servico"],
    fields: [{ key: "window_days", label: "Enviar até quantos dias depois da data", type: "number", suffix: "dias", min: 1, max: 30 }],
  },
  aniversario: {
    group: "relacionamento",
    title: "Aniversário",
    when: "No dia do aniversário, a partir do horário escolhido.",
    after: "Use {cupom} no texto para incluir o código do presente.",
    variables: [...CLIENT_VARS, "cupom"],
    fields: [
      { key: "hour", label: "Enviar a partir de", type: "time" },
      { key: "coupon", label: "Cupom (opcional)", type: "text" },
    ],
  },
  reativacao: {
    group: "relacionamento",
    title: "Reativação",
    when: "Sem visita há N dias e nada marcado. Quem mais gastou recebe primeiro.",
    after: "Não repete para a mesma cliente antes do intervalo escolhido.",
    variables: CLIENT_VARS,
    fields: [
      { key: "days", label: "Sem visita há", type: "number", suffix: "dias", min: 20, max: 365 },
      { key: "daily_max", label: "Máximo por dia", type: "number", suffix: "mensagens", min: 1, max: 50 },
      { key: "repeat_after_days", label: "Não repetir antes de", type: "number", suffix: "dias", min: 15, max: 365 },
    ],
  },
  pacote_acabando: {
    group: "relacionamento",
    title: "Pacote acabando",
    when: "Quando restam poucas sessões ou o pacote está perto de vencer.",
    after: "Uma mensagem por pacote e motivo (sessões ou validade).",
    variables: [...CLIENT_VARS, "pacote", "detalhe_pacote"],
    fields: [
      { key: "sessions_left", label: "Avisar quando restarem", type: "number", suffix: "sessões", min: 1, max: 5 },
      { key: "days_before_expiry", label: "Ou faltarem", type: "number", suffix: "dias para vencer", min: 1, max: 30 },
    ],
  },
};

export const MESSAGE_KIND_LABEL: Record<MessageKind, string> = {
  ...Object.fromEntries(AUTOMATION_ORDER.map((k) => [k, AUTOMATION_META[k].title])) as Record<AutomationKind, string>,
  campanha: "Campanha",
  manual: "Mensagem da equipe",
  resposta: "Resposta automática",
  teste: "Teste",
};

export const VARIABLE_HINT: Record<string, string> = {
  nome: "primeiro nome",
  servico: "serviço(s)",
  profissional: "profissional",
  data: "dia da semana e data",
  hora: "horário",
  salao: "nome do salão",
  link_agendamento: "link de agendamento online",
  link_avaliacao: "link de avaliação no Google",
  cupom: "cupom do aniversário",
  pacote: "nome do pacote",
  detalhe_pacote: "\"resta 1 sessão\" ou \"vence em 10/11\"",
};

export const SAMPLE_VARS: Record<string, string> = {
  nome: "Juliana",
  servico: "Coloração + Escova",
  profissional: "Ana Souza",
  data: "sexta-feira, 24/10",
  hora: "15:00",
  salao: "seu salão",
  link_agendamento: "seusalao.com/agendar",
  link_avaliacao: "g.page/seu-salao/review",
  cupom: "ANIVER10",
  pacote: "4 escovas",
  detalhe_pacote: "resta 1 sessão",
};

/** Espelho do render_message do banco, para a prévia do texto. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let r = template;
  for (const [k, v] of Object.entries(vars)) r = r.split(`{${k}}`).join(v ?? "");
  return r.replace(/[ \t]{2,}/g, " ").trim();
}

/** Variáveis usadas no texto que a automação não conhece */
export function unknownVariables(template: string, allowed: string[]): string[] {
  const used = [...template.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
  return [...new Set(used.filter((v) => !allowed.includes(v)))];
}

export const CAMPAIGN_AUDIENCES = [
  { value: "reativar", label: "Para reativar", hint: "Sem visita há 60 dias ou mais e nada marcado" },
  { value: "retoque", label: "Hora de retocar", hint: "Passaram da data de retorno do serviço" },
  { value: "aniversariantes", label: "Aniversariantes do mês", hint: "Fazem aniversário neste mês" },
  { value: "ativos", label: "Clientes ativas", hint: "Vieram nos últimos 60 dias ou têm horário marcado" },
  { value: "todos", label: "Todos com WhatsApp", hint: "Toda a base com telefone e sem opt-out" },
] as const;

export function bookingUrl(slug: string, origin = typeof window !== "undefined" ? window.location.origin : ""): string {
  return `${origin}/agendar/${slug}`;
}

/** Espelho do phone_key do banco: país + DDD + 8 últimos dígitos (ignora o 9 do celular). */
export function phoneKey(p: string | null | undefined): string | null {
  let d = (p ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return /^55\d{10,11}$/.test(d) ? d.slice(0, 4) + d.slice(-8) : d;
}
