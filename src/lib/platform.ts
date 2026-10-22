import { num } from "@/lib/format";
import type { PlatformSalon } from "@/lib/types";

export const WHATSAPP_LABEL: Record<NonNullable<PlatformSalon["whatsapp_status"]>, string> = {
  conectado: "Conectado",
  pendente: "Configurando",
  desconectado: "Desconectado",
  erro: "Com erro",
  desligado: "Desligado",
};

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  criar_salao: "Salão criado",
  suspender: "Salão suspenso",
  reativar: "Salão reativado",
  mudar_plano: "Plano alterado",
  editar_plano: "Limites do plano editados",
  mover_usuario: "Usuário movido",
  adicionar_usuario: "Acesso dado a outro salão",
};

/** "2 de 3" ou "2 · sem limite" */
export function limitLabel(used: number, max: number | null): string {
  return max === null ? `${num(used)} · sem limite` : `${num(used)} de ${num(max)}`;
}

/** 80% do limite ou mais. */
export function nearLimit(used: number, max: number | null): boolean {
  return max !== null && used >= max * 0.8;
}

export const TIMEZONES = [
  "America/Sao_Paulo", "America/Bahia", "America/Fortaleza", "America/Recife", "America/Belem",
  "America/Manaus", "America/Cuiaba", "America/Campo_Grande", "America/Porto_Velho", "America/Boa_Vista",
  "America/Rio_Branco", "America/Noronha",
];
