export const pctFmt = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

/** Taxa 0..1 como "42,5%"; sem base vira "—". */
export function pct(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : pctFmt.format(v);
}

/** Amostra pequena não vira conclusão: abaixo de 3 casos mostramos "poucos". */
export const MIN_SAMPLE = 3;
export function sampled(n: number, value: string): string {
  return n < MIN_SAMPLE ? "poucos" : value;
}

export const WEEKDAY_SHORT = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
