import type { AppointmentOrigin, AppointmentStatus, BlockKind, ClientOrigin, LifecycleStatus, SalonRole, TechNoteKind } from "./types";

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  em_atendimento: "Em atendimento",
  concluido: "Concluído",
  nao_compareceu: "Não compareceu",
  cancelado: "Cancelado",
  reagendado: "Reagendado",
};

export const STATUS_ORDER: AppointmentStatus[] = [
  "agendado", "confirmado", "em_atendimento", "concluido", "nao_compareceu", "cancelado", "reagendado",
];

/** Classes do badge por status. */
export const STATUS_STYLE: Record<AppointmentStatus, string> = {
  agendado: "bg-secondary text-secondary-foreground",
  confirmado: "bg-success/15 text-success",
  em_atendimento: "bg-copper/15 text-accent-foreground",
  concluido: "bg-primary text-primary-foreground",
  nao_compareceu: "bg-destructive/12 text-destructive",
  cancelado: "bg-muted text-muted-foreground line-through",
  reagendado: "bg-muted text-muted-foreground",
};

/** Status que ainda ocupam o horário na agenda. */
export const ACTIVE_STATUSES: AppointmentStatus[] = ["agendado", "confirmado", "em_atendimento", "concluido", "nao_compareceu"];

export const ORIGIN_LABEL: Record<AppointmentOrigin, string> = {
  recepcao: "Recepção",
  link_online: "Link online",
  whatsapp: "WhatsApp",
  profissional: "Profissional",
};

export const CLIENT_ORIGIN_LABEL: Record<ClientOrigin, string> = {
  indicacao: "Indicação",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  google: "Google",
  meta_ads: "Meta Ads",
  link_online: "Link online",
  passante: "Passou na porta",
  outro: "Outro",
};

export const LIFECYCLE_LABEL: Record<LifecycleStatus, string> = {
  novo: "Novo lead",
  agendado: "Agendado",
  ativo: "Cliente ativo",
  em_risco: "Em risco",
  inativo: "Inativo",
  perdido: "Perdido",
};

export const LIFECYCLE_STYLE: Record<LifecycleStatus, string> = {
  novo: "bg-accent text-accent-foreground",
  agendado: "bg-secondary text-secondary-foreground",
  ativo: "bg-success/15 text-success",
  em_risco: "bg-warning/15 text-warning",
  inativo: "bg-muted text-muted-foreground",
  perdido: "bg-destructive/12 text-destructive",
};

export const BLOCK_LABEL: Record<BlockKind, string> = {
  folga: "Folga",
  almoco: "Almoço",
  bloqueio: "Bloqueio",
  ferias: "Férias",
  feriado: "Feriado",
};

export const ROLE_LABEL: Record<SalonRole, string> = {
  admin: "Administrador",
  recepcao: "Recepção",
  profissional: "Profissional",
};

export const TECH_NOTE_LABEL: Record<TechNoteKind, string> = {
  coloracao: "Fórmula de coloração",
  cabelo: "Tipo de cabelo",
  unhas: "Unhas",
  pele: "Pele",
  alergia: "Alergia declarada",
  geral: "Observação",
};

export const PROFESSIONAL_COLORS = ["#B87A5E", "#7A8F6B", "#6B7A9F", "#A86B8F", "#C29A4B", "#5E9A96", "#9F6B6B", "#7D6BA8"];
