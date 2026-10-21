import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/common/SectionCard";
import { usePaymentMethods, useSavePaymentMethod } from "@/hooks/useFinance";
import { PAYMENT_KIND_LABEL } from "@/lib/finance";
import { errorMessage } from "@/lib/errors";
import type { PaymentKind, PaymentMethod } from "@/lib/types";

type Draft = { id?: string; name: string; kind: PaymentKind; fee_pct: string; installment_fee_pct: string; max_installments: string; active: boolean };

const toDraft = (m: PaymentMethod): Draft => ({
  id: m.id, name: m.name, kind: m.kind, fee_pct: String(Number(m.fee_pct)), installment_fee_pct: String(Number(m.installment_fee_pct)),
  max_installments: String(m.max_installments), active: m.active,
});
const parse = (v: string) => Number(v.replace(",", "."));

/** Formas de pagamento e taxas da maquininha (base do líquido e das comissões). */
export function PaymentMethodsCard() {
  const { data: methods = [] } = usePaymentMethods();
  const save = useSavePaymentMethod();
  const [rows, setRows] = useState<Draft[]>([]);

  useEffect(() => setRows(methods.map(toDraft)), [methods]);

  const set = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    try {
      for (const [i, r] of rows.entries()) {
        if (!r.name.trim()) return toast.error("Toda forma precisa de um nome");
        await save.mutateAsync({
          ...(r.id ? { id: r.id } : {}),
          name: r.name.trim(), kind: r.kind, fee_pct: parse(r.fee_pct) || 0,
          installment_fee_pct: r.kind === "credito" ? parse(r.installment_fee_pct) || 0 : 0,
          max_installments: r.kind === "credito" ? Math.max(1, Math.round(parse(r.max_installments) || 1)) : 1,
          active: r.active, sort_order: i + 1,
        });
      }
      toast.success("Formas de pagamento salvas");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SectionCard title="Formas de pagamento" hint="A taxa de cada maquininha entra no relatório do caixa e, se você marcar acima, sai da base da comissão.">
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className="space-y-2 rounded-xl border border-border p-3">
            <div className="flex items-center gap-2">
              <Input aria-label="Nome" value={r.name} onChange={(e) => set(i, { name: e.target.value })} className="flex-1" />
              <Select value={r.kind} onValueChange={(v) => set(i, { kind: v as PaymentKind })}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(PAYMENT_KIND_LABEL) as PaymentKind[]).map((k) => <SelectItem key={k} value={k}>{PAYMENT_KIND_LABEL[k]}</SelectItem>)}</SelectContent>
              </Select>
              <Switch aria-label="Ativa" checked={r.active} onCheckedChange={(v) => set(i, { active: v })} />
            </div>
            {r.kind !== "dinheiro" && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>Taxa</span>
                <Input aria-label="Taxa %" className="h-8 w-20" inputMode="decimal" value={r.fee_pct} onChange={(e) => set(i, { fee_pct: e.target.value })} />
                <span>%</span>
                {r.kind === "credito" && (
                  <>
                    <span className="ml-2">até</span>
                    <Input aria-label="Parcelas" className="h-8 w-14" inputMode="numeric" value={r.max_installments} onChange={(e) => set(i, { max_installments: e.target.value })} />
                    <span>x, +</span>
                    <Input aria-label="Taxa por parcela %" className="h-8 w-16" inputMode="decimal" value={r.installment_fee_pct} onChange={(e) => set(i, { installment_fee_pct: e.target.value })} />
                    <span>% por parcela extra</span>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, { name: "", kind: "outro", fee_pct: "0", installment_fee_pct: "0", max_installments: "1", active: true }])}>
            <Plus className="mr-1 h-4 w-4" /> Forma de pagamento
          </Button>
          <Button size="sm" onClick={submit} disabled={save.isPending}>Salvar formas</Button>
        </div>
      </div>
    </SectionCard>
  );
}
