import { Link } from "react-router-dom";
import { Gift, Receipt } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { OrderStatusBadge } from "@/components/common/StatusBadge";
import { useClientOrders } from "@/hooks/useFinance";
import { useClientPackages } from "@/hooks/useStock";
import { money } from "@/lib/format";
import { fmtDate } from "@/lib/tz";
import { cn } from "@/lib/utils";

/** Aba da ficha da cliente: saldo de pacotes e comandas. */
export function ClientOrdersTab({ clientId, tz }: { clientId: string; tz: string }) {
  const { data: orders = [] } = useClientOrders(clientId);
  const { data: balances = [] } = useClientPackages(clientId);
  const usable = balances.filter((b) => b.usable);
  const paid = orders.filter((o) => o.status === "fechada");
  const products = paid.flatMap((o) => o.items.filter((i) => i.kind === "produto").map((i) => i.description));

  return (
    <div className="space-y-6">
      <div>
        <div className="label-caps mb-2">Pacotes</div>
        {balances.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pacote comprado. Venda um pacote pela comanda.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {balances.map((b) => (
              <div key={b.balance_id} className={cn("rounded-2xl border border-border bg-card p-4 shadow-soft", !b.usable && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{b.service_name}</div>
                    <div className="text-xs text-muted-foreground">{b.package_name} · comprado em {fmtDate(b.purchased_at, tz)}</div>
                  </div>
                  <Gift className="h-4 w-4 text-copper" />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-copper" style={{ width: `${(b.sessions_used / b.sessions_total) * 100}%` }} />
                  </div>
                  <span className="text-xs">{b.sessions_left} de {b.sessions_total} restantes</span>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {b.status === "cancelado" ? "Cancelado" : b.expires_at ? `Vale até ${fmtDate(b.expires_at, tz)}` : "Sem validade"}
                </div>
              </div>
            ))}
          </div>
        )}
        {usable.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Ao abrir a comanda pelo agendamento, a sessão é usada sozinha.</p>}
      </div>

      {products.length > 0 && (
        <div>
          <div className="label-caps mb-2">Produtos que já levou</div>
          <p className="text-sm">{[...new Set(products)].join(" · ")}</p>
        </div>
      )}

      <div>
        <div className="label-caps mb-2">Comandas</div>
        {orders.length === 0 ? (
          <EmptyState icon={Receipt} title="Nenhuma comanda" description="As comandas pagas desta cliente aparecem aqui, com o que foi consumido." />
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {orders.map((o) => (
              <Link key={o.id} to={`/comandas/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-muted/50">
                <span className="w-24">{fmtDate(o.closed_at ?? o.opened_at, tz)}</span>
                <span className="w-14 text-muted-foreground">#{o.number}</span>
                <span className="min-w-[160px] flex-1 truncate">{o.items.map((i) => i.description).join(" + ") || "Sem itens"}</span>
                <span className="w-24 text-right">{money(Number(o.total))}</span>
                <OrderStatusBadge status={o.status} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
