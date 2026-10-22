import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveClient } from "@/hooks/useClients";
import { CLIENT_ORIGIN_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { formatPhone, normalizePhone } from "@/lib/format";
import type { Client, ClientOrigin } from "@/lib/types";

export function ClientDialog({ open, onOpenChange, client, onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  client?: Client | null;
  onSaved?: (id: string) => void;
}) {
  const save = useSaveClient();
  const [form, setForm] = useState({
    name: "", phone: "", email: "", birth_date: "", origin: "outro" as ClientOrigin, tags: "", notes: "", opt_out: false, photo_consent: false,
  });

  useEffect(() => {
    if (!open) return;
    setForm(client ? {
      name: client.name, phone: client.phone ? formatPhone(client.phone) : "", email: client.email ?? "",
      birth_date: client.birth_date ?? "", origin: client.origin, tags: client.tags.join(", "), notes: client.notes ?? "",
      opt_out: client.opt_out, photo_consent: Boolean(client.photo_consent_at),
    } : { name: "", phone: "", email: "", birth_date: "", origin: "outro", tags: "", notes: "", opt_out: false, photo_consent: false });
  }, [open, client]);

  const submit = async () => {
    if (form.name.trim().length < 2) return toast.error("Informe o nome");
    try {
      const id = await save.mutateAsync({
        ...(client ? { id: client.id } : {}),
        name: form.name.trim(),
        phone: normalizePhone(form.phone),
        email: form.email.trim() || null,
        birth_date: form.birth_date || null,
        origin: form.origin,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        notes: form.notes.trim() || null,
        opt_out: form.opt_out,
        photo_consent_at: form.photo_consent ? client?.photo_consent_at ?? new Date().toISOString() : null,
      });
      toast.success(client ? "Cliente atualizada" : "Cliente cadastrada");
      onOpenChange(false);
      onSaved?.(id);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-display font-medium">{client ? "Editar cliente" : "Nova cliente"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>WhatsApp</Label><Input placeholder="(11) 99999-9999" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="space-y-1"><Label>Nascimento</Label><Input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} /></div>
            <div className="space-y-1"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div className="space-y-1">
              <Label>Como conheceu</Label>
              <Select value={form.origin} onValueChange={(v) => setForm({ ...form, origin: v as ClientOrigin })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CLIENT_ORIGIN_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label>Etiquetas</Label><Input placeholder="vip, noiva, cabelo cacheado" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></div>
          <div className="space-y-1"><Label>Observações</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
            <span>Autoriza fotos de antes/depois<span className="block text-xs text-muted-foreground">Consentimento registrado com data (LGPD).</span></span>
            <Switch checked={form.photo_consent} onCheckedChange={(v) => setForm({ ...form, photo_consent: v })} />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
            <span>Não quer receber mensagens de marketing</span>
            <Switch checked={form.opt_out} onCheckedChange={(v) => setForm({ ...form, opt_out: v })} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
