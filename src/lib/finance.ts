import type { CashMovementKind, OrderStatus, PaymentKind, PaymentMethod, Product, StockMovementKind } from "./types";

/** Centavos evitam erro de arredondamento ao somar pagamentos. */
export const toCents = (v: number) => Math.round(v * 100);
export const fromCents = (c: number) => c / 100;

/** Mesmo cálculo do banco (close_order): % + % por parcela extra, arredondado em centavos. */
export function paymentFee(method: Pick<PaymentMethod, "fee_pct" | "installment_fee_pct">, amount: number, installments = 1): number {
  const pct = Number(method.fee_pct) + (installments - 1) * Number(method.installment_fee_pct);
  return fromCents(Math.round((toCents(amount) * pct) / 100));
}

export type PaymentDraft = { payment_method_id: string; amount: number; installments: number; received?: number };

/** Quanto falta pagar e quanto de troco devolver (troco só existe no dinheiro). */
export function paymentBalance(total: number, payments: PaymentDraft[], methods: PaymentMethod[]) {
  const paid = payments.reduce((a, p) => a + toCents(p.amount || 0), 0);
  const change = payments.reduce((a, p) => {
    const m = methods.find((x) => x.id === p.payment_method_id);
    if (m?.kind !== "dinheiro" || p.received === undefined) return a;
    return a + Math.max(0, toCents(p.received) - toCents(p.amount || 0));
  }, 0);
  return { remaining: fromCents(toCents(total) - paid), change: fromCents(change) };
}

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", voucher: "Voucher", outro: "Outro",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = { aberta: "Aberta", fechada: "Paga", cancelada: "Cancelada" };
export const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
  aberta: "bg-warning/12 text-warning border-warning/30",
  fechada: "bg-success/12 text-success border-success/25",
  cancelada: "bg-muted text-muted-foreground border-border line-through",
};

export const CASH_MOVEMENT_LABEL: Record<CashMovementKind, string> = {
  suprimento: "Suprimento", sangria: "Sangria", despesa: "Despesa", estorno: "Estorno",
};

export const STOCK_KIND_LABEL: Record<StockMovementKind, string> = {
  entrada: "Entrada", venda: "Venda", uso: "Uso em serviço", ajuste: "Ajuste", perda: "Perda", estorno: "Estorno",
};

const qtyFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });

/**
 * Estoque fica na unidade base (un, ml, g). Para produto em ml/g mostra também
 * em embalagens: "1.320 ml (≈ 1,5 frasco de 900 ml)".
 */
export function stockLabel(p: Pick<Product, "unit" | "package_size">, qty: number): string {
  if (p.unit === "un") return `${qtyFmt.format(qty)} un`;
  const base = `${qtyFmt.format(qty)} ${p.unit}`;
  const packs = qty / Number(p.package_size);
  return Number(p.package_size) > 1 ? `${base} (≈ ${qtyFmt.format(packs)} emb.)` : base;
}

export function stockLevel(p: Pick<Product, "current_stock" | "min_stock">): "zerado" | "baixo" | "ok" {
  if (Number(p.current_stock) <= 0) return "zerado";
  if (Number(p.current_stock) <= Number(p.min_stock)) return "baixo";
  return "ok";
}
