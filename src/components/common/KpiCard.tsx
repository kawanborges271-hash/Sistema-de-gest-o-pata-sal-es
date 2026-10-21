import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: string;
  /** Fórmula escrita embaixo do número, ex.: "Faturamento ÷ comandas" */
  formula?: string;
  icon?: LucideIcon;
  highlight?: boolean;
}

export function KpiCard({ label, value, formula, icon: Icon, highlight }: KpiCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-card p-5 shadow-soft",
        highlight && "border-transparent bg-primary text-primary-foreground",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className={cn("label-caps", highlight && "text-primary-foreground/60")}>{label}</div>
        {Icon && (
          <span className={cn("grid h-8 w-8 place-items-center rounded-lg bg-muted", highlight && "bg-white/10")}>
            <Icon className={cn("h-4 w-4 text-foreground/70", highlight && "text-copper")} />
          </span>
        )}
      </div>
      <div className="mt-3 font-display text-3xl font-light tracking-tight">{value}</div>
      {formula && (
        <div className={cn("mt-2 text-xs text-muted-foreground", highlight && "text-primary-foreground/55")}>{formula}</div>
      )}
    </div>
  );
}
