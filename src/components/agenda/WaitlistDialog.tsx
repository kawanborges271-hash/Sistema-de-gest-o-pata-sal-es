import { useState } from "react";
import { toast } from "sonner";
import { Hourglass, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientPicker, type PickedClient } from "@/components/clientes/ClientPicker";
import { useProfessionals, useServices } from "@/hooks/useCatalog";
import { useSaveWaitlist, useWaitlist } from "@/hooks/useAgenda";
import { errorMessage } from "@/lib/errors";
import { formatPhone } from "@/lib/format";
import { fmtDate } from "@/lib/tz";

const PERIOD = { qualquer: "Qualquer horário", manha: "Manhã", tarde: "Tarde", noite: "Noite" } as const;

export function WaitlistDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: list = [] } = useWaitlist();
  const { data: services = [] } = useServices();
  const { data: pros = [] } = useProfessionals();
  const save = useSaveWaitlist();
  const [client, setClient] = useState<PickedClient | null>(null);
  const [form, setForm] = useState({ service_id: "any", professional_id: "any", period: "qualquer" as keyof typeof PERIOD, date_to: "", notes: "" });

  const add = async () => {
    if (!client) return toast.error("Escolha a cliente");
    try {
      await save.mutateAsync({
        client_id: client.id,
        service_id: form.service_id === "any" ? null : form.service_id,
        professional_id: form.professional_id === "any" ? null : form.professional_id,
        period: form.period,
        date_to: form.date_to || null,
        notes: form.notes.trim() || null,
      });
      toast.success("Cliente na lista de espera");
      setClient(null);
      setForm({ ...form, notes: "", date_to: "" });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-display font-medium">Lista de espera</DialogTitle></DialogHeader>
        <p className="-mt-2 text-sm text-muted-foreground">Quando um horário for cancelado, a agenda sugere quem está esperando por aquele serviço.</p>
        <div className="space-y-3 rounded-xl border border-border p-3">
          <ClientPicker value={client} onChange={setClient} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={form.service_id} onValueChange={(v) => setForm({ ...form, service_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer serviço</SelectItem>
                {services.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.professional_id} onValueChange={(v) => setForm({ ...form, professional_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Qualquer profissional</SelectItem>
                {pros.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={form.period} onValueChange={(v) => setForm({ ...form, period: v as keyof typeof PERIOD })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(PERIOD).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <div><Label className="sr-only">Até</Label><Input type="date" value={form.date_to} onChange={(e) => setForm({ ...form, date_to: e.target.value })} title="Espera até (opcional)" /></div>
          </div>
          <Input placeholder="Observação (opcional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <Button onClick={add} disabled={save.isPending} className="w-full">Adicionar à lista</Button>
        </div>

        <div className="space-y-2">
          {list.length === 0 && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Hourglass className="h-4 w-4" /> Ninguém esperando agora.</div>
          )}
          {list.map((w) => (
            <div key={w.id} className="flex items-center gap-3 rounded-xl border border-border p-3 text-sm">
              <div className="flex-1">
                <div className="font-medium">{w.client?.name}</div>
                <div className="text-xs text-muted-foreground">
                  {w.service_id ? services.find((s) => s.id === w.service_id)?.name : "Qualquer serviço"}
                  {" · "}{w.professional_id ? pros.find((p) => p.id === w.professional_id)?.name : "qualquer profissional"}
                  {" · "}{PERIOD[w.period]}{w.date_to && ` · até ${fmtDate(w.date_to + "T12:00:00Z", "UTC")}`}
                  {" · "}{formatPhone(w.client?.phone)}
                </div>
              </div>
              <button className="rounded p-1.5 hover:bg-muted" aria-label="Tirar da lista" onClick={() => save.mutate({ id: w.id, status: "desistiu" })}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
