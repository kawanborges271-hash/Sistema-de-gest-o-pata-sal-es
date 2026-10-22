import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { money, num } from "@/lib/format";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { LOYALTY_REASON_LABEL } from "@/lib/loyalty";
import type { LoyaltyMovement } from "@/lib/types";

export function LoyaltyLedgerList({ rows, showClient }: { rows: LoyaltyMovement[]; showClient?: boolean }) {
  const tz = useAuth().salon!.timezone;
  if (!rows.length) return <p className="p-5 text-sm text-muted-foreground">Nenhum movimento ainda.</p>;
  return (
    <ul>
      {rows.map((m) => {
        const v = Number(m.amount);
        return (
          <li key={m.id} className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-sm first:border-0">
            <span className="w-16 shrink-0 text-xs text-muted-foreground">{fmt(m.created_at, "dd/MM/yy", tz)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {showClient && m.client && <Link to={`/clientes/${m.client_id}`} className="font-medium hover:underline">{m.client.name} · </Link>}
                {LOYALTY_REASON_LABEL[m.reason]}
              </span>
              {m.note && <span className="block truncate text-xs text-muted-foreground">{m.note}</span>}
            </span>
            <span className={cn("w-24 text-right font-semibold tabular-nums", v < 0 ? "text-rose-600" : "text-emerald-600")}>
              {v > 0 ? "+" : ""}{m.kind === "pontos" ? `${num(v)} pts` : money(v)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
