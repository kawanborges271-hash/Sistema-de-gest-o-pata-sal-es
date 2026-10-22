import type { LoyaltyReason } from "@/lib/types";

export const LOYALTY_REASON_LABEL: Record<LoyaltyReason, string> = {
  compra: "Compra",
  resgate: "Resgate",
  indicacao: "Indicação",
  uso_credito: "Uso de crédito",
  estorno: "Estorno",
  ajuste: "Ajuste",
};
