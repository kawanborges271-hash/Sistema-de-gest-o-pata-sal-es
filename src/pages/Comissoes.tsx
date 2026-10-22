import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BadgeDollarSign, CalendarRange, HandCoins, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { SectionCard } from "@/components/common/SectionCard";
import { useAuth } from "@/contexts/AuthContext";
import { useProfessionals } from "@/hooks/useCatalog";
import { useCommissions, usePayCommissions, usePayouts, usePendingCommissions } from "@/hooks/useCommissions";
import { usePermissions } from "@/hooks/usePermissions";
import { money, num } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { addDaysKey, fmtDate, todayKey } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { CommissionStatus } from "@/lib/types";

type Period = "mes" | "mes_passado" | "15d";
const PERIOD_LABEL: Record<Period, string> = { mes: "Este mês", mes_passado: "Mês passado", "15d": "Últimos 15 dias" };
const STATUS_LABEL: Record<CommissionStatus, string> = { pendente: "a pagar", paga: "paga", estornada: "estornada" };

function periodRange(p: Period, today: string): [string, string] {
  const first = `${today.slice(0, 8)}01`;
  if (p === "mes") return [first, today];
  if (p === "15d") return [addDaysKey(today, -14), today];
  const lastPrev = addDaysKey(first, -1);
  return [`${lastPrev.slice(0, 8)}01`, lastPrev];
}

const dayLabel = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function Comissoes() {
  const { salon, professionalId } = useAuth();
  const tz = salon!.timezone;
  const { can } = usePermissions();
  const isAdmin = can("comissoes.pagar");
  const today = todayKey(tz);
  const [period, setPeriod] = useState<Period>("mes");
  const [from, to] = periodRange(period, today);
  const [selected, setSelected] = useState<string | "todos">(isAdmin ? "todos" : professionalId ?? "todos");

  const { data: pros = [] } = useProfessionals();
  const { data: entries = [] } = useCommissions(from, to, selected === "todos" ? undefined : selected);
  const { data: allPeriod = [] } = useCommissions(from, to);
  const { data: pending = [] } = usePendingCommissions();
  const { data: payouts = [] } = usePayouts();
  const pay = usePayCommissions();

  const [showAll, setShowAll] = useState(false);
  const [paying, setPaying] = useState<{ professionalId: string; until: string; method: string; notes: string; fromCash: boolean } | null>(null);

  const visiblePros = isAdmin ? pros.filter((p) => p.active || pending.some((c) => c.professional_id === p.id)) : pros.filter((p) => p.id === professionalId);
  const proName = (id: string) => pros.find((p) => p.id === id)?.name ?? "Profissional";

  const byPro = useMemo(() => visiblePros.map((p) => {
    const mine = allPeriod.filter((c) => c.professional_id === p.id && c.status !== "estornada");
    return {
      pro: p,
      period: mine.reduce((a, c) => a + Number(c.amount), 0),
      base: mine.filter((c) => !c.reversal_of_id).reduce((a, c) => a + Number(c.base_amount), 0),
      count: mine.filter((c) => !c.reversal_of_id).length,
      pending: pending.filter((c) => c.professional_id === p.id).reduce((a, c) => a + Number(c.amount), 0),
    };
  }), [visiblePros, allPeriod, pending]);

  const totalPending = byPro.reduce((a, r) => a + r.pending, 0);
  const totalPeriod = byPro.reduce((a, r) => a + r.period, 0);
  const totalBase = byPro.reduce((a, r) => a + r.base, 0);
  const payingAmount = paying
    ? pending.filter((c) => c.professional_id === paying.professionalId && c.competence_date <= paying.until).reduce((a, c) => a + Number(c.amount), 0)
    : 0;

  const confirmPay = async () => {
    if (!paying) return;
    try {
      await pay.mutateAsync(paying);
      toast.success(`Pagamento de ${money(payingAmount)} registrado`);
      setPaying(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Gestão · Comissões"
        title={isAdmin ? "Quanto cada profissional tem a receber." : "Suas comissões, atendimento por atendimento."}
        subtitle={isAdmin
          ? `Calculadas quando a comanda é paga, ${salon!.commission_base === "bruto" ? "sobre o valor bruto (menos descontos)" : "sobre o valor líquido"}. Registre o acerto quando pagar.`
          : "Cada serviço pago gera a sua comissão. O que já foi acertado aparece como paga."}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={cn("rounded-full border px-3 py-1.5 text-xs transition-colors",
              period === p ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
            {PERIOD_LABEL[p]}
          </button>
        ))}
        <span className="self-center pl-2 text-xs text-muted-foreground">{fmtDate(`${from}T12:00:00Z`, "UTC")} a {fmtDate(`${to}T12:00:00Z`, "UTC")}</span>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="A pagar agora" value={money(totalPending)} formula="Comissões pendentes de qualquer data" icon={HandCoins} highlight />
        <KpiCard label={`Comissão · ${PERIOD_LABEL[period]}`} value={money(totalPeriod)} formula="Gerada nas comandas pagas no período" icon={Percent} />
        <KpiCard label="Produção no período" value={money(totalBase)} formula="Soma das bases de cálculo" icon={BadgeDollarSign} />
      </div>

      {isAdmin && (
        <SectionCard title="Por profissional" bodyClassName="p-0" className="mb-6">
          <div className="divide-y divide-border">
            {byPro.map((r) => (
              <div key={r.pro.id} className="flex flex-col gap-2 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                <div className="flex items-center gap-2 sm:w-48">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.pro.color }} />
                  <span className="font-medium">{r.pro.name}</span>
                </div>
                <div className="flex-1 text-muted-foreground">{num(r.count)} itens · produção {money(r.base)} · comissão {money(r.period)}</div>
                <div className="flex items-center gap-3">
                  <span className={cn("font-medium", r.pending > 0 ? "text-foreground" : "text-muted-foreground")}>{money(r.pending)} a pagar</span>
                  <Button size="sm" variant="outline" disabled={r.pending <= 0}
                    onClick={() => setPaying({ professionalId: r.pro.id, until: today, method: "Pix", notes: "", fromCash: false })}>
                    Registrar pagamento
                  </Button>
                </div>
              </div>
            ))}
            {byPro.length === 0 && <p className="p-5 text-sm text-muted-foreground">Nenhum profissional cadastrado.</p>}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Lançamentos"
        bodyClassName="p-0"
        actions={isAdmin && (
          <select aria-label="Profissional" value={selected} onChange={(e) => setSelected(e.target.value)}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs">
            <option value="todos">Todos</option>
            {visiblePros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
      >
        {entries.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Nenhuma comissão no período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 font-medium">Dia</th>
                  <th className="px-3 py-2 font-medium">Comanda</th>
                  {isAdmin && selected === "todos" && <th className="px-3 py-2 font-medium">Profissional</th>}
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Base</th>
                  <th className="px-3 py-2 text-right font-medium">%</th>
                  <th className="px-3 py-2 text-right font-medium">Comissão</th>
                  <th className="px-5 py-2 font-medium">Situação</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? entries : entries.slice(0, 40)).map((c) => (
                  <tr key={c.id} className={cn("border-b border-border last:border-0", c.status === "estornada" && "text-muted-foreground line-through")}>
                    <td className="px-5 py-2">{dayLabel(c.competence_date)}</td>
                    <td className="px-3 py-2 text-muted-foreground">#{c.order_number}</td>
                    {isAdmin && selected === "todos" && <td className="px-3 py-2">{proName(c.professional_id)}</td>}
                    <td className="px-3 py-2">{c.description}</td>
                    <td className="px-3 py-2 text-right">{money(Number(c.base_amount))}</td>
                    <td className="px-3 py-2 text-right">{num(Number(c.pct))}</td>
                    <td className={cn("px-3 py-2 text-right font-medium", Number(c.amount) < 0 && "text-destructive")}>{money(Number(c.amount))}</td>
                    <td className="px-5 py-2 text-xs">{STATUS_LABEL[c.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length > 40 && !showAll && (
              <div className="border-t border-border p-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>Mostrar todos os {entries.length} lançamentos</Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Acertos feitos" className="mt-6" bodyClassName="p-0">
        {payouts.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Os pagamentos de comissão registrados aparecem aqui.</p>
        ) : (
          <div className="divide-y divide-border">
            {payouts.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="w-24 text-xs text-muted-foreground">{fmtDate(p.paid_at, tz)}</span>
                <span className="flex-1">{proName(p.professional_id)} <span className="text-muted-foreground">· até {fmtDate(`${p.period_until}T12:00:00Z`, "UTC")}{p.method && ` · ${p.method}`}</span></span>
                <span className="font-medium">{money(Number(p.total))}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Dialog open={Boolean(paying)} onOpenChange={(o) => !o && setPaying(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle className="font-display font-medium">Pagar {paying && proName(paying.professionalId)}</DialogTitle></DialogHeader>
          {paying && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pay-until">Pagar o que foi gerado até</Label>
                <Input id="pay-until" type="date" max={today} value={paying.until} onChange={(e) => setPaying({ ...paying, until: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
                <span>Valor do acerto</span><span className="font-display text-xl">{money(payingAmount)}</span>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-method">Como foi pago</Label>
                <Input id="pay-method" value={paying.method} onChange={(e) => setPaying({ ...paying, method: e.target.value })} placeholder="Pix, transferência…" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pay-notes">Observação</Label>
                <Input id="pay-notes" value={paying.notes} onChange={(e) => setPaying({ ...paying, notes: e.target.value })} />
              </div>
              <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                <span>Saiu do dinheiro do caixa<span className="block text-xs text-muted-foreground">Registra uma despesa no caixa aberto</span></span>
                <Switch checked={paying.fromCash} onCheckedChange={(v) => setPaying({ ...paying, fromCash: v, method: v ? "Dinheiro do caixa" : paying.method })} />
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaying(null)}>Cancelar</Button>
            <Button onClick={confirmPay} disabled={pay.isPending || payingAmount <= 0}><CalendarRange className="mr-1 h-4 w-4" /> Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
