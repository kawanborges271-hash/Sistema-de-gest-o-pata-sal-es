import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateSalon, usePlans } from "@/hooks/usePlatform";
import { errorMessage } from "@/lib/errors";
import { TIMEZONES } from "@/lib/platform";

/** Cria o salão. Dono com conta vira admin na hora; sem conta, sai um link de convite para mandar. */
export function NewSalonDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: plans = [] } = usePlans();
  const create = useCreateSalon();
  const [form, setForm] = useState({ name: "", email: "", plan: "basico", timezone: "America/Sao_Paulo" });
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  useEffect(() => {
    if (open) { setForm({ name: "", email: "", plan: "basico", timezone: "America/Sao_Paulo" }); setInviteUrl(null); }
  }, [open]);

  const submit = async () => {
    if (form.name.trim().length < 2) return toast.error("Informe o nome do salão");
    try {
      const r = await create.mutateAsync({ name: form.name.trim(), ownerEmail: form.email.trim(), planId: form.plan, timezone: form.timezone });
      if (r.invitation_token) {
        setInviteUrl(`${window.location.origin}/convite/${r.invitation_token}`);
        toast.success("Salão criado. Mande o link para a dona criar a conta.");
      } else {
        toast.success("Salão criado. A dona já tinha conta e virou administradora.");
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">Novo salão</DialogTitle>
          <p className="text-sm text-muted-foreground">A dona termina o cadastro (endereço, horário, equipe) no primeiro acesso.</p>
        </DialogHeader>
        {inviteUrl ? (
          <div className="space-y-3">
            <Label className="text-xs">Link de convite (vale 7 dias)</Label>
            <div className="flex gap-2">
              <Input readOnly value={inviteUrl} className="font-mono text-xs" aria-label="Link de convite" />
              <Button variant="outline" size="icon" aria-label="Copiar link"
                onClick={() => navigator.clipboard?.writeText(inviteUrl).then(() => toast.success("Link copiado"))}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Quem abrir precisa criar a conta com o e-mail {form.email.trim().toLowerCase()}.</p>
            <DialogFooter><Button onClick={() => onOpenChange(false)}>Pronto</Button></DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="ns-name" className="text-xs">Nome do salão</Label>
                <Input id="ns-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ns-email" className="text-xs">E-mail da dona</Label>
                <Input id="ns-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Plano</Label>
                  <Select value={form.plan} onValueChange={(v) => setForm({ ...form, plan: v })}>
                    <SelectTrigger aria-label="Plano"><SelectValue /></SelectTrigger>
                    <SelectContent>{plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fuso horário</Label>
                  <Select value={form.timezone} onValueChange={(v) => setForm({ ...form, timezone: v })}>
                    <SelectTrigger aria-label="Fuso horário"><SelectValue /></SelectTrigger>
                    <SelectContent>{TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t.replace("America/", "").replace("_", " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={create.isPending}>Criar salão</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
