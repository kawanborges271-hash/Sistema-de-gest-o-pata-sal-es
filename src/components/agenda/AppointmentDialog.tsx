import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientPicker, type PickedClient } from "@/components/clientes/ClientPicker";
import { useProfessionalServices, useProfessionals, useServices } from "@/hooks/useCatalog";
import { useCreateAppointment } from "@/hooks/useAgenda";
import { useAuth } from "@/contexts/AuthContext";
import { CONFLICT_MESSAGE, errorMessage, scheduleConflict, type ScheduleConflict } from "@/lib/errors";
import { minutesLabel, money } from "@/lib/format";
import { hhmmToMinutes, minutesToHhmm, zonedToUtc } from "@/lib/tz";

export type AppointmentDefaults = { day: string; time: string; professional_id?: string | null; client?: PickedClient | null };

type Row = { service_id: string; professional_id: string };

export function AppointmentDialog({ open, onOpenChange, defaults, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaults: AppointmentDefaults;
  onCreated?: (id: string) => void;
}) {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const { data: services = [] } = useServices();
  const { data: pros = [] } = useProfessionals();
  const { data: links = [] } = useProfessionalServices();
  const create = useCreateAppointment();

  const [client, setClient] = useState<PickedClient | null>(null);
  const [day, setDay] = useState(defaults.day);
  const [time, setTime] = useState(defaults.time);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [conflict, setConflict] = useState<ScheduleConflict | null>(null);

  const activePros = pros.filter((p) => p.active);
  const activeServices = services.filter((s) => s.active);

  useEffect(() => {
    if (!open) return;
    setClient(defaults.client ?? null);
    setDay(defaults.day);
    setTime(defaults.time);
    setRows([{ service_id: "", professional_id: defaults.professional_id ?? "" }]);
    setNotes("");
    setConfirmed(false);
    setConflict(null);
    // só ao abrir: defaults costuma ser um objeto novo a cada render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const doesService = (proId: string, serviceId: string) =>
    links.some((l) => l.professional_id === proId && l.service_id === serviceId);
  const override = (proId: string, serviceId: string) =>
    links.find((l) => l.professional_id === proId && l.service_id === serviceId);

  const computed = useMemo(() => {
    let cursor = hhmmToMinutes(time || "09:00");
    return rows.map((r) => {
      const s = services.find((x) => x.id === r.service_id);
      const o = override(r.professional_id, r.service_id);
      const duration = o?.duration_minutes ?? s?.duration_minutes ?? 0;
      const price = o?.price ?? s?.price ?? 0;
      const start = cursor;
      cursor += duration;
      return { ...r, start, end: cursor, duration, price: Number(price) };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, time, services, links]);

  const total = computed.reduce((a, r) => a + r.price, 0);
  const totalMin = computed.reduce((a, r) => a + r.duration, 0);

  const setRow = (i: number, patch: Partial<Row>) => {
    setConflict(null);
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        // troca de serviço: se o profissional não faz, sugere quem faz
        if (patch.service_id && next.professional_id && !doesService(next.professional_id, patch.service_id)) {
          next.professional_id = activePros.find((p) => doesService(p.id, patch.service_id!))?.id ?? next.professional_id;
        }
        if (patch.service_id && !next.professional_id) {
          next.professional_id = activePros.find((p) => doesService(p.id, patch.service_id!))?.id ?? "";
        }
        return next;
      }),
    );
  };

  const submit = async (squeeze = false) => {
    if (!client) return toast.error("Escolha a cliente");
    if (computed.some((r) => !r.service_id || !r.professional_id)) return toast.error("Complete serviço e profissional de cada linha");
    if (computed.some((r) => r.end >= 24 * 60)) return toast.error("O atendimento passa da meia-noite");
    try {
      const id = await create.mutateAsync({
        client_id: client.id,
        status: confirmed ? "confirmado" : "agendado",
        notes: notes.trim() || null,
        items: computed.map((r) => ({
          service_id: r.service_id,
          professional_id: r.professional_id,
          starts_at: zonedToUtc(day, minutesToHhmm(r.start), tz).toISOString(),
          is_squeeze: squeeze,
        })),
      });
      toast.success(squeeze ? "Encaixe marcado" : "Agendamento criado");
      onOpenChange(false);
      onCreated?.(id);
    } catch (err) {
      const c = scheduleConflict(err);
      if (c) setConflict(c);
      else toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">Novo agendamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Cliente</Label>
            <ClientPicker value={client} onChange={setClient} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Data</Label><Input type="date" value={day} onChange={(e) => { setDay(e.target.value); setConflict(null); }} /></div>
            <div className="space-y-2"><Label>Início</Label><Input type="time" step={300} value={time} onChange={(e) => { setTime(e.target.value); setConflict(null); }} /></div>
          </div>

          <div className="space-y-2">
            <Label>Serviços em sequência</Label>
            {computed.map((r, i) => {
              const prosForService = r.service_id ? activePros.filter((p) => doesService(p.id, r.service_id)) : activePros;
              const servicesForPro = r.professional_id ? activeServices.filter((s) => doesService(r.professional_id, s.id)) : activeServices;
              return (
                <div key={i} className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{minutesToHhmm(r.start)}–{minutesToHhmm(r.end)} · {minutesLabel(r.duration || 0)} · {money(r.price)}</span>
                    {rows.length > 1 && (
                      <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="rounded p-1 hover:bg-muted" aria-label="Remover serviço">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select value={r.service_id} onValueChange={(v) => setRow(i, { service_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Serviço" /></SelectTrigger>
                      <SelectContent>
                        {(servicesForPro.length ? servicesForPro : activeServices).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={r.professional_id} onValueChange={(v) => setRow(i, { professional_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Profissional" /></SelectTrigger>
                      <SelectContent>
                        {(prosForService.length ? prosForService : activePros).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="ghost" size="sm"
              onClick={() => setRows((rs) => [...rs, { service_id: "", professional_id: rs.at(-1)?.professional_id ?? "" }])}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar serviço
            </Button>
          </div>

          <div className="space-y-2"><Label>Observação</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: prefere água sem gás, vem com a filha" /></div>
          <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
            <span>Já confirmado com a cliente</span>
            <Switch checked={confirmed} onCheckedChange={setConfirmed} />
          </label>

          <div className="flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-sm">
            <span>Total: <b>{minutesLabel(totalMin || 0)}</b>{totalMin > 0 && ` · termina ${minutesToHhmm(hhmmToMinutes(time || "09:00") + totalMin)}`}</span>
            <span className="font-display text-lg">{money(total)}</span>
          </div>

          {conflict && (
            <div className="flex gap-3 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="flex-1">
                <div className="font-medium">{CONFLICT_MESSAGE[conflict]}</div>
                <div className="text-muted-foreground">Escolha outro horário ou marque como encaixe.</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => submit(true)} disabled={create.isPending}>Marcar encaixe</Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => submit(false)} disabled={create.isPending}>{create.isPending ? "Salvando…" : "Agendar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
