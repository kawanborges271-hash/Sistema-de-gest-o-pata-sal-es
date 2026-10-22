import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Receipt, ShoppingBag, TrendingUp, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { OrderStatusBadge } from "@/components/common/StatusBadge";
import { ClientPicker, type PickedClient } from "@/components/clientes/ClientPicker";
import { useAuth } from "@/contexts/AuthContext";
import { useCreateOrder, useOpenCash, useOrders } from "@/hooks/useFinance";
import { money, num } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { addDaysKey, fmt, fmtTime, todayKey, zonedToUtc } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Order } from "@/lib/types";

type Period = "hoje" | "7d" | "30d";
const PERIOD_LABEL: Record<Period, string> = { hoje: "Hoje", "7d": "7 dias", "30d": "30 dias" };

export default function Comandas() {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>("hoje");
  const today = todayKey(tz);
  const fromDay = period === "hoje" ? today : addDaysKey(today, period === "7d" ? -6 : -29);
  const fromIso = zonedToUtc(fromDay, "00:00", tz).toISOString();
  const toIso = zonedToUtc(addDaysKey(today, 1), "00:00", tz).toISOString();

  const { data: open = [], isLoading } = useOrders({ status: "aberta" });
  const { data: paid = [] } = useOrders({ status: "fechada", fromIso, toIso });
  const { data: cancelled = [] } = useOrders({ status: "cancelada", fromIso, toIso });
  const { data: cash } = useOpenCash();
  const create = useCreateOrder();

  const [newOpen, setNewOpen] = useState(false);
  const [client, setClient] = useState<PickedClient | null>(null);

  const revenue = paid.reduce((a, o) => a + Number(o.total), 0);
  const openTotal = open.reduce((a, o) => a + Number(o.total), 0);

  const start = async (withClient: boolean) => {
    try {
      const id = await create.mutateAsync(withClient ? client?.id ?? null : null);
      setNewOpen(false);
      setClient(null);
      navigate(`/comandas/${id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const row = (o: Order) => (
    <Link key={o.id} to={`/comandas/${o.id}`}
      className="flex items-center gap-3 border-b border-border px-5 py-3 text-sm last:border-0 hover:bg-muted/50">
      <span className="w-12 font-display text-muted-foreground">#{o.number}</span>
      <span className="min-w-0 flex-1 truncate">{o.client?.name ?? "Venda avulsa"}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">{fmt(o.closed_at ?? o.cancelled_at ?? o.opened_at, "dd/MM HH:mm", tz)}</span>
      <OrderStatusBadge status={o.status} />
      <span className="w-24 text-right font-medium">{money(Number(o.total))}</span>
    </Link>
  );

  return (
    <div>
      <PageHeader
        eyebrow="Operação · Comandas"
        title="Tudo o que a cliente consumiu, numa conta só."
        subtitle="Abra a comanda pelo agendamento ou aqui, lance serviços, produtos e pacotes, e receba em uma ou mais formas de pagamento."
        actions={<Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nova comanda</Button>}
      />

      {cash && !cash.session && (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>O caixa está fechado. Dá para lançar itens, mas para receber é preciso abrir o caixa.</span>
          <Button size="sm" variant="outline" asChild><Link to="/caixa"><Wallet className="mr-1 h-4 w-4" /> Abrir caixa</Link></Button>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Abertas agora" value={num(open.length)} formula={`${money(openTotal)} a receber`} icon={Receipt} highlight />
        <KpiCard label={`Faturado · ${PERIOD_LABEL[period]}`} value={money(revenue)} formula="Soma das comandas pagas no período" icon={TrendingUp} />
        <KpiCard label="Ticket médio" value={money(paid.length ? revenue / paid.length : null)} formula="Faturado ÷ comandas pagas" icon={ShoppingBag} />
      </div>

      <div className="mb-3 label-caps">Abertas</div>
      {open.length === 0 && !isLoading ? (
        <EmptyState icon={Receipt} title="Nenhuma comanda aberta"
          description="Na agenda, abra o atendimento e toque em Abrir comanda. Para venda de balcão, use Nova comanda."
          action={<Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nova comanda</Button>} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {open.map((o) => (
            <Link key={o.id} to={`/comandas/${o.id}`} className="rounded-2xl border border-border bg-card p-4 shadow-soft transition-shadow hover:shadow-elev">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{o.client?.name ?? "Venda avulsa"}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">#{o.number} · aberta às {fmtTime(o.opened_at, tz)}</div>
                </div>
                <div className="font-display text-lg">{money(Number(o.total))}</div>
              </div>
              {o.appointment_id && <div className="mt-3 text-xs text-muted-foreground">Do agendamento</div>}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-3 mt-8 flex flex-wrap items-center justify-between gap-2">
        <div className="label-caps">Pagas e canceladas</div>
        <div className="flex gap-1.5">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={cn("rounded-full border px-3 py-1.5 text-xs transition-colors",
                period === p ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card shadow-soft">
        {paid.length + cancelled.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nenhuma comanda paga no período.</p>
        ) : (
          [...paid, ...cancelled].sort((a, b) => b.number - a.number).map(row)
        )}
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="font-display font-medium">Nova comanda</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Cliente</Label>
            <ClientPicker value={client} onChange={setClient} />
            <p className="text-xs text-muted-foreground">Para vender pacote ou registrar no histórico, escolha a cliente. Venda de balcão pode ser avulsa.</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => start(false)} disabled={create.isPending}>Venda avulsa</Button>
            <Button onClick={() => start(true)} disabled={!client || create.isPending}>Abrir comanda</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
