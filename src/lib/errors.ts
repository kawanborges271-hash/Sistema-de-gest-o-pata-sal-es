/** Traduz erros do Postgres/Supabase para mensagens da recepção. */
export type ScheduleConflict = "sobreposicao" | "jornada" | "bloqueio";

export function scheduleConflict(err: unknown): ScheduleConflict | null {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return null;
  if (e.code === "23P01") return "sobreposicao";
  if (e.message?.startsWith("FORA_DA_JORNADA")) return "jornada";
  if (e.message?.startsWith("BLOQUEIO")) return "bloqueio";
  return null;
}

export const CONFLICT_MESSAGE: Record<ScheduleConflict, string> = {
  sobreposicao: "Esse profissional já tem atendimento nesse horário.",
  jornada: "Esse horário está fora da jornada do profissional.",
  bloqueio: "Esse horário está bloqueado na agenda.",
};

export function errorMessage(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  if (!e?.message) return "Algo deu errado. Tente de novo.";
  const conflict = scheduleConflict(e);
  if (conflict) return CONFLICT_MESSAGE[conflict];
  // Regras do caixa/comanda vêm com prefixo; a tela mostra só a frase
  const prefixed = e.message.match(/^(CAIXA_FECHADO|PAGAMENTO_DIFERENTE|HORARIO_INDISPONIVEL|LIMITE_PLANO|LIMITE|OPT_OUT|MODO_LEITURA): (.*)$/);
  if (prefixed) return prefixed[2].charAt(0).toUpperCase() + prefixed[2].slice(1);
  if (e.code === "25006") return "Modo leitura: alterações estão bloqueadas.";
  if (e.code === "23505") return "Já existe um registro com esses dados (ex.: telefone repetido).";
  if (e.code === "42501" || e.message.includes("row-level security")) return "Seu papel não permite essa ação.";
  return e.message;
}

export function isCashClosed(err: unknown): boolean {
  return Boolean((err as { message?: string } | null)?.message?.startsWith("CAIXA_FECHADO"));
}
