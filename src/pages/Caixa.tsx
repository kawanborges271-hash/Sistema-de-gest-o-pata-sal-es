import { useState } from "react";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Banknote, CreditCard, Lock, Receipt, ShoppingBag, Unlock, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { SectionCard } from "@/components/common/SectionCard";
import { useAuth } from "@/contexts/AuthContext";
import { useAddCashMovement, useCashHistory, useCloseCashSession, useOpenCash, useOpenCashSession } from "@/hooks/useFinance";
import { CASH_MOVEMENT_LABEL, PAYMENT_KIND_LABEL, toCents } from "@/lib/finance";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { fmt, fmtDate, fmtTime } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { CashMovementKind, PaymentKind } from "@/lib/types";

type ManualKind = Exclude<CashMovementKind, "estorno">;

const MOVEMENT_HINT: Record<ManualKind, string> = {
  suprimento: "Dinheiro que entra na gaveta (ex.: troco trazido do banco).",
  sangria: "Dinheiro retirado da gaveta para guardar ou depositar.",
  despesa: "Pagamento feito com o dinheiro da gaveta (ex.: café, entregador).",
};

export default function Caixa() {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const { data: cash, isLoading } = useOpenCash();
  const { data: history = [] } = useCashHistory();
  const openSession = useOpenCashSession();
  const closeSession = useCloseCashSession();
  const addMovement = useAddCashMovement();

  const [opening, setOpening] = useState("200");
  const [counted, setCounted] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [movement, setMovement] = useState<{ kind: ManualKind; amount: string; description: string } | null>(null);

  const s = cash?.summary;
  const countedNum = counted.trim() === "" ? null : Number(counted.replace(",", "."));
  const diff = s && countedNum !== null && !Number.isNaN(countedNum) ? (toCents(countedNum) - toCents(Number(s.expected_cash))) / 100 : null;

  const doOpen = async () => {
    const v = Number(opening.replace(",", "."));
    if (Number.isNaN(v) || v < 0) return toast.error("Valor de abertura inválido");
    try {
      await openSession.mutateAsync(v);
      toast.success("Caixa aberto");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const doClose = async () => {
    if (!cash?.session || countedNum === null || Number.isNaN(countedNum)) return toast.error("Informe quanto há na gaveta");
    try {
      const d = await closeSession.mutateAsync({ id: cash.session.id, counted: countedNum, notes: closeNotes.trim() });
      setCounted("");
      setCloseNotes("");
      toast.success(d === 0 ? "Caixa fechado e conferido" : `Caixa fechado com diferença de ${money(d)}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const saveMovement = async () => {
    if (!movement || !cash?.session) return;
    const amount = Number(movement.amount.replace(",", "."));
    if (!amount || amount <= 0) return toast.error("Informe o valor");
    if (!movement.description.trim()) return toast.error("Descreva a movimentação");
    try {
      await addMovement.mutateAsync({ cash_session_id: cash.session.id, kind: movement.kind, amount, description: movement.description.trim() });
      toast.success(`${CASH_MOVEMENT_LABEL[movement.kind]} registrada`);
      setMovement(null);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="Operação · Caixa"
        title="O dinheiro do dia, conferido."
        subtitle="Abra o caixa com o troco, feche as comandas ao longo do dia e confira a gaveta no fim. Toda diferença fica registrada."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !cash?.session ? (
        <SectionCard title="O caixa está fechado" hint="Sem caixa aberto não dá para fechar comandas.">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="opening">Troco inicial na gaveta (R$)</Label>
              <Input id="opening" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} className="sm:w-48" />
            </div>
            <Button onClick={doOpen} disabled={openSession.isPending}><Unlock className="mr-1 h-4 w-4" /> Abrir caixa</Button>
          </div>
        </SectionCard>
      ) : (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            Aberto em {fmt(cash.session.opened_at, "dd/MM 'às' HH:mm", tz)} com {money(Number(cash.session.opening_amount))} de troco.
          </p>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Recebido" value={money(Number(s!.received_total))} formula="Soma dos pagamentos das comandas" icon={Receipt} highlight />
            <KpiCard label="Dinheiro na gaveta" value={money(Number(s!.expected_cash))} formula="Troco + dinheiro + suprimentos − sangrias − despesas − estornos" icon={Banknote} />
            <KpiCard label="Comandas pagas" value={String(s!.orders_count)} formula="Comandas fechadas neste caixa" icon={ShoppingBag} />
            <KpiCard label="Taxas das maquininhas" value={money(Number(s!.fees_total))} formula="Débito e crédito, pela taxa cadastrada" icon={CreditCard} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
            <div className="space-y-6">
              <SectionCard title="Por forma de pagamento">
                {Object.keys(s!.received_by_kind ?? {}).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum pagamento ainda neste caixa.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {(Object.entries(s!.received_by_kind) as [PaymentKind, number][]).map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between py-2 text-sm">
                        <span>{PAYMENT_KIND_LABEL[k]}</span>
                        <span className="font-medium">{money(Number(v))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              <SectionCard
                title="Movimentações da gaveta"
                actions={
                  <div className="flex flex-wrap gap-1.5">
                    {(["suprimento", "sangria", "despesa"] as ManualKind[]).map((k) => (
                      <Button key={k} size="sm" variant="outline" onClick={() => setMovement({ kind: k, amount: "", description: "" })}>
                        {k === "suprimento" ? <ArrowDownCircle className="mr-1 h-3.5 w-3.5" /> : <ArrowUpCircle className="mr-1 h-3.5 w-3.5" />}
                        {CASH_MOVEMENT_LABEL[k]}
                      </Button>
                    ))}
                  </div>
                }
              >
                {cash.movements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma sangria, suprimento ou despesa.</p>
                ) : (
                  <div className="divide-y divide-border">
                    {cash.movements.map((m) => (
                      <div key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate">{m.description}</div>
                          <div className="text-xs text-muted-foreground">{CASH_MOVEMENT_LABEL[m.kind]} · {fmtTime(m.created_at, tz)}</div>
                        </div>
                        <span className={cn("whitespace-nowrap font-medium", m.kind === "suprimento" ? "text-success" : "text-destructive")}>
                          {m.kind === "suprimento" ? "+" : "−"} {money(Number(m.amount))}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            </div>

            <SectionCard title="Fechar o caixa" hint="Conte o dinheiro da gaveta. Pix e cartão não entram na contagem.">
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-xl bg-muted/60 p-3 text-sm">
                  <span>Esperado em dinheiro</span>
                  <span className="font-display text-xl">{money(Number(s!.expected_cash))}</span>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="counted">Contei na gaveta (R$)</Label>
                  <Input id="counted" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0,00" />
                </div>
                {diff !== null && (
                  <div className={cn("rounded-xl border p-3 text-sm",
                    diff === 0 ? "border-success/30 bg-success/10 text-success" : "border-warning/40 bg-warning/10")}>
                    {diff === 0 ? "Bate certinho com o esperado." : diff > 0 ? `Sobrando ${money(diff)}.` : `Faltando ${money(-diff)}.`}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="close-notes">Observação (opcional)</Label>
                  <Textarea id="close-notes" rows={2} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Ex.: troco de R$ 5 dado a mais" />
                </div>
                <Button onClick={doClose} disabled={closeSession.isPending || diff === null}><Lock className="mr-1 h-4 w-4" /> Fechar caixa</Button>
              </div>
            </SectionCard>
          </div>
        </>
      )}

      <SectionCard title="Caixas anteriores" className="mt-6" bodyClassName="p-0">
        {history.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Os caixas fechados aparecem aqui.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="px-5 py-2 font-medium">Dia</th>
                  <th className="px-3 py-2 font-medium">Horário</th>
                  <th className="px-3 py-2 text-right font-medium">Recebido</th>
                  <th className="px-3 py-2 text-right font-medium">Esperado</th>
                  <th className="px-3 py-2 text-right font-medium">Contado</th>
                  <th className="px-5 py-2 text-right font-medium">Diferença</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.cash_session_id} className="border-b border-border last:border-0">
                    <td className="px-5 py-2.5">{fmtDate(h.opened_at, tz)}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{fmtTime(h.opened_at, tz)}–{h.closed_at ? fmtTime(h.closed_at, tz) : ""}</td>
                    <td className="px-3 py-2.5 text-right">{money(Number(h.received_total))}</td>
                    <td className="px-3 py-2.5 text-right">{money(Number(h.expected_cash))}</td>
                    <td className="px-3 py-2.5 text-right">{money(h.counted_amount === null ? null : Number(h.counted_amount))}</td>
                    <td className={cn("px-5 py-2.5 text-right font-medium",
                      Number(h.difference) < 0 ? "text-destructive" : Number(h.difference) > 0 ? "text-warning" : "text-success")}>
                      {Number(h.difference) === 0 ? "ok" : money(Number(h.difference))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Dialog open={Boolean(movement)} onOpenChange={(o) => !o && setMovement(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-display font-medium">{movement && CASH_MOVEMENT_LABEL[movement.kind]}</DialogTitle>
          </DialogHeader>
          {movement && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{MOVEMENT_HINT[movement.kind]}</p>
              <div className="space-y-2">
                <Label htmlFor="mv-amount">Valor (R$)</Label>
                <Input id="mv-amount" autoFocus inputMode="decimal" value={movement.amount} onChange={(e) => setMovement({ ...movement, amount: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mv-desc">Descrição</Label>
                <Input id="mv-desc" value={movement.description} onChange={(e) => setMovement({ ...movement, description: e.target.value })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMovement(null)}>Cancelar</Button>
            <Button onClick={saveMovement} disabled={addMovement.isPending}><Wallet className="mr-1 h-4 w-4" /> Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
