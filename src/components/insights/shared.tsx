import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { pctFmt } from "@/lib/insights";

/** Variação contra o período anterior. `inverse` quando subir é ruim (ex.: faltas). */
export function Delta({ current, previous, inverse, points }: {
  current: number | null | undefined;
  previous: number | null | undefined;
  inverse?: boolean;
  /** Para taxas: mostra diferença em pontos percentuais em vez de variação relativa. */
  points?: boolean;
}) {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return <span className="text-xs text-muted-foreground">sem comparação</span>;
  }
  const diff = current - previous;
  let label: string;
  if (points) label = `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1).replace(".", ",")} p.p.`;
  else if (previous === 0) label = current === 0 ? "igual" : "novo";
  else label = `${diff >= 0 ? "+" : ""}${pctFmt.format(diff / Math.abs(previous))}`;
  const good = inverse ? diff < 0 : diff > 0;
  const Icon = Math.abs(diff) < 1e-9 ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold",
      Math.abs(diff) < 1e-9 ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
      <Icon className="h-3.5 w-3.5" />{label}
    </span>
  );
}

/** Card de indicador com fórmula escrita e comparação. */
export function MetricCard({ label, value, formula, compare, previousLabel, highlight, icon: Icon }: {
  label: string;
  value: string;
  formula: string;
  compare?: ReactNode;
  previousLabel?: string;
  highlight?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={cn("flex flex-col rounded-2xl border border-border bg-card p-5 shadow-soft",
      highlight && "border-transparent bg-primary text-primary-foreground")}>
      <div className="flex items-start justify-between gap-3">
        <div className={cn("label-caps", highlight && "text-primary-foreground/60")}>{label}</div>
        {Icon && (
          <span className={cn("grid h-8 w-8 place-items-center rounded-lg bg-muted", highlight && "bg-white/10")}>
            <Icon className={cn("h-4 w-4 text-foreground/70", highlight && "text-copper")} />
          </span>
        )}
      </div>
      <div className="mt-3 break-words font-display text-[26px] font-light leading-tight tracking-tight 2xl:text-3xl">{value}</div>
      {(compare || previousLabel) && (
        <div className={cn("mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", highlight ? "text-primary-foreground/60" : "text-muted-foreground")}>
          {compare}
          {previousLabel && <span>antes: {previousLabel}</span>}
        </div>
      )}
      <div className={cn("mt-auto pt-3 text-xs text-muted-foreground", highlight && "text-primary-foreground/55")}>{formula}</div>
    </div>
  );
}
