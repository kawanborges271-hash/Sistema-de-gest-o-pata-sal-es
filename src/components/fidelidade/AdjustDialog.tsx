import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClientPicker, type PickedClient } from "@/components/clientes/ClientPicker";
import { LOYALTY_REASON_LABEL } from "@/lib/loyalty";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAdjustLoyalty } from "@/hooks/useLoyalty";
import { errorMessage } from "@/lib/errors";

/** Ajuste de pontos ou crédito: exige motivo e fica no extrato. */
export function AdjustDialog({ open, onOpenChange, client: fixed }: { open: boolean; onOpenChange: (o: boolean) => void; client?: PickedClient }) {
  const adjust = useAdjustLoyalty();
  const [client, setClient] = useState<PickedClient | null>(fixed ?? null);
  const [form, setForm] = useState({ kind: "pontos" as "pontos" | "credito", amount: "", note: "" });
  useEffect(() => {
    if (open) { setClient(fixed ?? null); setForm({ kind: "pontos", amount: "", note: "" }); }
  }, [open, fixed]);

  const submit = async () => {
    const amount = Number(form.amount.replace(",", "."));
    if (!client) return toast.error("Escolha a cliente");
    if (!amount) return toast.error("Informe o valor (negativo para tirar)");
    if (form.note.trim().length < 3) return toast.error("Explique o motivo do ajuste");
    try {
      await adjust.mutateAsync({ clientId: client.id, kind: form.kind, amount, note: form.note.trim() });
      toast.success("Ajuste lançado");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">Ajuste manual</DialogTitle>
          <p className="text-sm text-muted-foreground">Entra como movimento “{LOYALTY_REASON_LABEL.ajuste}” com o seu nome e o motivo.</p>
        </DialogHeader>
        <div className="space-y-4">
          {!fixed && <div className="space-y-1.5"><Label className="text-xs">Cliente</Label><ClientPicker value={client} onChange={setClient} /></div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as "pontos" | "credito" })}>
                <SelectTrigger aria-label="Tipo"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pontos">Pontos</SelectItem><SelectItem value="credito">Crédito (R$)</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="adj-amount" className="text-xs">Valor</Label>
              <Input id="adj-amount" inputMode="decimal" placeholder="ex.: 100 ou -50" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj-note" className="text-xs">Motivo</Label>
            <Textarea id="adj-note" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={adjust.isPending}>Lançar ajuste</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
