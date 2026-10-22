import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCloseOrder, usePaymentMethods } from "@/hooks/useFinance";
import { paymentBalance, paymentFee, type PaymentDraft } from "@/lib/finance";
import { money } from "@/lib/format";
import { errorMessage, isCashClosed } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Row = { payment_method_id: string; amount: string; installments: number; received: string };

const parse = (v: string) => Number(v.replace(",", "."));
const brl = (v: number) => v.toFixed(2).replace(".", ",");

/** Fecha a comanda: uma ou mais formas de pagamento, parcelas no crédito e troco no dinheiro. */
export function PaymentDialog({ open, onOpenChange, orderId, total, onPaid }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orderId: string;
  total: number;
  onPaid: () => void;
}) {
  const { data: allMethods = [] } = usePaymentMethods();
  const methods = allMethods.filter((m) => m.active);
  const close = useCloseOrder();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (open) setRows(total > 0 && methods[0] ? [{ payment_method_id: methods[0].id, amount: brl(total), installments: 1, received: "" }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total, methods.length]);

  const drafts: PaymentDraft[] = rows.map((r) => ({
    payment_method_id: r.payment_method_id,
    amount: parse(r.amount) || 0,
    installments: r.installments,
    received: r.received.trim() ? parse(r.received) : undefined,
  }));
  const { remaining, change } = paymentBalance(total, drafts, methods);
  const fees = drafts.reduce((a, d) => {
    const m = methods.find((x) => x.id === d.payment_method_id);
    return m ? a + paymentFee(m, d.amount, d.installments) : a;
  }, 0);

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** Toque numa forma: completa o que falta com ela. */
  const quick = (methodId: string) => {
    if (remaining <= 0) return;
    const existing = rows.findIndex((r) => r.payment_method_id === methodId);
    if (existing >= 0) setRow(existing, { amount: brl(parse(rows[existing].amount || "0") + remaining) });
    else setRows((rs) => [...rs, { payment_method_id: methodId, amount: brl(remaining), installments: 1, received: "" }]);
  };

  const submit = async () => {
    if (remaining !== 0) return toast.error(remaining > 0 ? `Faltam ${money(remaining)}` : `Os pagamentos passam do total em ${money(-remaining)}`);
    try {
      await close.mutateAsync({ id: orderId, payments: drafts.filter((d) => d.amount > 0) });
      toast.success(change > 0 ? `Comanda paga. Troco: ${money(change)}` : "Comanda paga");
      onOpenChange(false);
      onPaid();
    } catch (err) {
      if (isCashClosed(err)) {
        toast.error("O caixa está fechado", { action: { label: "Abrir caixa", onClick: () => navigate("/caixa") } });
      } else toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">Receber {money(total)}</DialogTitle>
        </DialogHeader>

        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Nada a cobrar: os serviços desta comanda saem de pacote. Confirme para dar baixa nas sessões.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              {methods.map((m) => (
                <Button key={m.id} size="sm" variant="outline" disabled={remaining <= 0} onClick={() => quick(m.id)}>{m.name}</Button>
              ))}
            </div>

            {rows.map((r, i) => {
              const m = methods.find((x) => x.id === r.payment_method_id);
              return (
                <div key={i} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1.5">
                      <Label className="text-xs">Forma</Label>
                      <Select value={r.payment_method_id} onValueChange={(v) => setRow(i, { payment_method_id: v, installments: 1 })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{methods.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="w-32 space-y-1.5">
                      <Label className="text-xs" htmlFor={`pay-${i}`}>Valor (R$)</Label>
                      <Input id={`pay-${i}`} inputMode="decimal" value={r.amount} onChange={(e) => setRow(i, { amount: e.target.value })} />
                    </div>
                    <Button size="icon" variant="ghost" aria-label="Remover pagamento" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {m && m.max_installments > 1 && (
                    <div className="flex items-center gap-2 text-sm">
                      <Label className="text-xs">Parcelas</Label>
                      <Select value={String(r.installments)} onValueChange={(v) => setRow(i, { installments: Number(v) })}>
                        <SelectTrigger className="h-8 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: m.max_installments }, (_, k) => k + 1).map((n) => (
                            <SelectItem key={n} value={String(n)}>{n}x</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {r.installments > 1 && <span className="text-xs text-muted-foreground">{r.installments}x de {money((parse(r.amount) || 0) / r.installments)}</span>}
                    </div>
                  )}
                  {m?.kind === "dinheiro" && (
                    <div className="flex items-center gap-2 text-sm">
                      <Label className="text-xs" htmlFor={`recv-${i}`}>Recebido</Label>
                      <Input id={`recv-${i}`} inputMode="decimal" className="h-8 w-28" placeholder={r.amount} value={r.received}
                        onChange={(e) => setRow(i, { received: e.target.value })} />
                      <span className="text-xs text-muted-foreground">para calcular o troco</span>
                    </div>
                  )}
                </div>
              );
            })}

            {rows.length === 0 && (
              <Button variant="outline" size="sm" onClick={() => methods[0] && quick(methods[0].id)}><Plus className="mr-1 h-4 w-4" /> Adicionar pagamento</Button>
            )}

            <div className="space-y-1 rounded-xl bg-muted/60 p-3 text-sm">
              <div className={cn("flex justify-between font-medium", remaining !== 0 && "text-destructive")}>
                <span>{remaining >= 0 ? "Falta" : "Passou"}</span><span>{money(Math.abs(remaining))}</span>
              </div>
              {change > 0 && <div className="flex justify-between font-medium text-success"><span>Troco</span><span>{money(change)}</span></div>}
              {fees > 0 && <div className="flex justify-between text-xs text-muted-foreground"><span>Taxa estimada da maquininha</span><span>{money(fees)}</span></div>}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Voltar</Button>
          <Button onClick={submit} disabled={close.isPending || remaining !== 0}>{close.isPending ? "Fechando…" : "Confirmar pagamento"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
