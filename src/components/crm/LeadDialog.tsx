import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveLead } from "@/hooks/useCrm";
import { CLIENT_ORIGIN_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { normalizePhone } from "@/lib/format";
import type { ClientOrigin } from "@/lib/types";

/** Lead que chegou por fora (Instagram, indicação, ligação). Os do WhatsApp entram sozinhos. */
export function LeadDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const save = useSaveLead();
  const [form, setForm] = useState({ name: "", phone: "", origin: "instagram" as ClientOrigin, interest: "", notes: "" });
  useEffect(() => {
    if (open) setForm({ name: "", phone: "", origin: "instagram", interest: "", notes: "" });
  }, [open]);

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Informe o nome");
    const phone = form.phone ? normalizePhone(form.phone) : null;
    if (form.phone && (!phone || phone.length < 12)) return toast.error("Telefone inválido: use DDD + número");
    try {
      const id = await save.mutateAsync({
        name: form.name.trim(), phone, origin: form.origin, interest: form.interest.trim() || null, notes: form.notes.trim() || null,
      });
      toast.success("Lead criado");
      onOpenChange(false);
      onCreated?.(id);
    } catch (err) {
      const msg = errorMessage(err);
      toast.error(msg.includes("leads_salon_phone_uniq") ? "Já existe um lead com esse telefone" : msg);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">Novo lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lead-name">Nome</Label>
            <Input id="lead-name" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="lead-phone">WhatsApp</Label>
              <Input id="lead-phone" inputMode="tel" placeholder="(11) 99999-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Origem</Label>
              <Select value={form.origin} onValueChange={(v) => setForm({ ...form, origin: v as ClientOrigin })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CLIENT_ORIGIN_LABEL) as ClientOrigin[]).map((o) => <SelectItem key={o} value={o}>{CLIENT_ORIGIN_LABEL[o]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-interest">Interesse</Label>
            <Input id="lead-interest" placeholder="Ex.: mechas, alongamento de unha" value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-notes">Observações</Label>
            <Textarea id="lead-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>Criar lead</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
