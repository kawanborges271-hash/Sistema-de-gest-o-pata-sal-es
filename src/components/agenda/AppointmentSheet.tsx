import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, CalendarClock, Check, MessageCircle, Play, UserX, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/StatusBadge";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useProfessionalServices, useProfessionals, useServices } from "@/hooks/useCatalog";
import {
  fetchWaitlistSuggestions, useAppointment, useReschedule, useSetStatus, useUpdateAppointmentNotes, type WaitlistSuggestion,
} from "@/hooks/useAgenda";
import { ORIGIN_LABEL } from "@/lib/agenda";
import { CONFLICT_MESSAGE, errorMessage, scheduleConflict, type ScheduleConflict } from "@/lib/errors";
import { formatPhone, money } from "@/lib/format";
import { dayKey, fmt, fmtTime, zonedToUtc } from "@/lib/tz";
import type { AppointmentStatus } from "@/lib/types";
import type { AppointmentDefaults } from "./AppointmentDialog";

export function AppointmentSheet({ id, onOpenChange, onSelect, onBook }: {
  id: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onBook: (d: AppointmentDefaults, waitlistId: string) => void;
}) {
  const { salon, role } = useAuth();
  const tz = salon!.timezone;
  const { can } = usePermissions();
  const manage = can("agenda.gerenciar");
  const { data: appt } = useAppointment(id);
  const { data: services = [] } = useServices();
  const { data: pros = [] } = useProfessionals();
  const { data: links = [] } = useProfessionalServices();
  const setStatus = useSetStatus();
  const reschedule = useReschedule();
  const saveNotes = useUpdateAppointmentNotes();

  const [mode, setMode] = useState<"view" | "reschedule" | "cancel">("view");
  const [reason, setReason] = useState("");
  const [newDay, setNewDay] = useState("");
  const [newTime, setNewTime] = useState("");
  const [newPro, setNewPro] = useState<string>("same");
  const [conflict, setConflict] = useState<ScheduleConflict | null>(null);
  const [notes, setNotes] = useState("");
  const [suggestions, setSuggestions] = useState<WaitlistSuggestion[] | null>(null);

  useEffect(() => {
    setMode("view");
    setReason("");
    setConflict(null);
    setSuggestions(null);
    setNewPro("same");
  }, [id]);
  useEffect(() => {
    if (appt) {
      setNotes(appt.notes ?? "");
      setNewDay(dayKey(appt.starts_at, tz));
      setNewTime(fmtTime(appt.starts_at, tz));
    }
  }, [appt, tz]);

  const svc = (sid: string) => services.find((s) => s.id === sid);
  const pro = (pid: string) => pros.find((p) => p.id === pid);
  const total = (appt?.items ?? []).reduce((a, i) => a + Number(i.price), 0);
  const singlePro = new Set((appt?.items ?? []).map((i) => i.professional_id)).size === 1;

  const change = async (status: AppointmentStatus, r?: string) => {
    if (!appt) return;
    try {
      await setStatus.mutateAsync({ id: appt.id, status, reason: r });
      toast.success("Status atualizado");
      if (status === "cancelado" || status === "nao_compareceu") {
        const list = await fetchWaitlistSuggestions(appt.id).catch(() => []);
        setSuggestions(list);
      }
      setMode("view");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const doReschedule = async (squeeze = false) => {
    if (!appt) return;
    try {
      const newId = await reschedule.mutateAsync({
        id: appt.id,
        starts_at: zonedToUtc(newDay, newTime, tz).toISOString(),
        professional_id: newPro === "same" ? null : newPro,
        squeeze,
      });
      toast.success("Remarcado");
      onSelect(newId);
    } catch (err) {
      const c = scheduleConflict(err);
      if (c) setConflict(c);
      else toast.error(errorMessage(err));
    }
  };

  const open = Boolean(id);
  const st = appt?.status;
  const live = st === "agendado" || st === "confirmado";
  const waLink = appt?.client?.phone ? `https://wa.me/${appt.client.phone.replace(/\D/g, "")}` : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {!appt ? (
          <div className="pt-10 text-sm text-muted-foreground">Carregando…</div>
        ) : (
          <>
            <SheetHeader className="text-left">
              <div className="flex items-center gap-2"><StatusBadge status={appt.status} /><span className="text-xs text-muted-foreground">{ORIGIN_LABEL[appt.origin]}</span></div>
              <SheetTitle className="font-display text-2xl font-light">
                {appt.client ? <Link to={`/clientes/${appt.client.id}`} className="hover:underline">{appt.client.name}</Link> : "Cliente"}
              </SheetTitle>
              <div className="text-sm text-muted-foreground">
                {fmt(appt.starts_at, "EEEE, dd/MM", tz)} · {fmtTime(appt.starts_at, tz)}–{fmtTime(appt.ends_at, tz)}
              </div>
            </SheetHeader>

            <div className="mt-5 space-y-5">
              {appt.client?.phone && (
                <div className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                  <span>{formatPhone(appt.client.phone)}</span>
                  {waLink && (
                    <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-success hover:underline">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </a>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {(appt.items ?? []).map((i) => {
                  const p = pro(i.professional_id);
                  return (
                    <div key={i.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                      <span className="h-8 w-1 rounded-full" style={{ background: p?.color }} />
                      <div className="flex-1 text-sm">
                        <div className="font-medium">{svc(i.service_id)?.name ?? "Serviço"}{i.is_squeeze && <span className="ml-2 rounded bg-warning/15 px-1.5 text-[10px] text-warning">encaixe</span>}</div>
                        <div className="text-xs text-muted-foreground">{fmtTime(i.starts_at, tz)}–{fmtTime(i.ends_at, tz)} · {p?.name}</div>
                      </div>
                      <div className="text-sm">{money(Number(i.price))}</div>
                    </div>
                  );
                })}
                <div className="flex justify-between px-1 text-sm"><span className="text-muted-foreground">Total previsto</span><b>{money(total)}</b></div>
              </div>

              {appt.rescheduled_to_id && (
                <Button variant="outline" className="w-full" onClick={() => onSelect(appt.rescheduled_to_id!)}>Ver novo horário <ArrowRight className="ml-1 h-4 w-4" /></Button>
              )}
              {appt.rescheduled_from_id && (
                <button className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => onSelect(appt.rescheduled_from_id!)}>Remarcado de outro horário · ver original</button>
              )}
              {appt.cancel_reason && <p className="text-sm text-muted-foreground">Motivo: {appt.cancel_reason}</p>}

              {mode === "view" && (
                <div className="grid grid-cols-2 gap-2">
                  {st === "agendado" && <Button variant="outline" onClick={() => change("confirmado")}><Check className="mr-1 h-4 w-4" /> Confirmar</Button>}
                  {live && <Button onClick={() => change("em_atendimento")}><Play className="mr-1 h-4 w-4" /> Iniciar atendimento</Button>}
                  {(live || st === "em_atendimento") && <Button variant={st === "em_atendimento" ? "default" : "outline"} onClick={() => change("concluido")}><Check className="mr-1 h-4 w-4" /> Concluir</Button>}
                  {live && <Button variant="outline" onClick={() => change("nao_compareceu")}><UserX className="mr-1 h-4 w-4" /> Não veio</Button>}
                  {manage && live && <Button variant="outline" onClick={() => setMode("reschedule")}><CalendarClock className="mr-1 h-4 w-4" /> Remarcar</Button>}
                  {manage && live && <Button variant="ghost" className="text-destructive" onClick={() => setMode("cancel")}><X className="mr-1 h-4 w-4" /> Cancelar</Button>}
                  {manage && (st === "cancelado" || st === "nao_compareceu") && <Button variant="outline" onClick={() => change("agendado")}>Reabrir</Button>}
                </div>
              )}

              {mode === "cancel" && (
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <Label>Motivo do cancelamento</Label>
                  <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: imprevisto no trabalho" />
                  <div className="flex gap-2">
                    <Button variant="destructive" onClick={() => change("cancelado", reason.trim() || undefined)}>Cancelar agendamento</Button>
                    <Button variant="ghost" onClick={() => setMode("view")}>Voltar</Button>
                  </div>
                </div>
              )}

              {mode === "reschedule" && (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1"><Label>Nova data</Label><Input type="date" value={newDay} onChange={(e) => { setNewDay(e.target.value); setConflict(null); }} /></div>
                    <div className="space-y-1"><Label>Horário</Label><Input type="time" step={300} value={newTime} onChange={(e) => { setNewTime(e.target.value); setConflict(null); }} /></div>
                  </div>
                  {singlePro && (
                    <div className="space-y-1">
                      <Label>Profissional</Label>
                      <Select value={newPro} onValueChange={(v) => { setNewPro(v); setConflict(null); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="same">Manter {pro(appt.items![0].professional_id)?.name}</SelectItem>
                          {pros
                            .filter((p) => p.active && p.id !== appt.items![0].professional_id)
                            .filter((p) => (appt.items ?? []).every((i) => links.some((l) => l.professional_id === p.id && l.service_id === i.service_id)))
                            .map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {conflict && (
                    <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-xs">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                      <span className="flex-1">{CONFLICT_MESSAGE[conflict]}</span>
                      <Button size="sm" variant="outline" className="h-7" onClick={() => doReschedule(true)}>Encaixar</Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={() => doReschedule(false)} disabled={reschedule.isPending}>Remarcar</Button>
                    <Button variant="ghost" onClick={() => setMode("view")}>Voltar</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">O horário atual fica como "Reagendado" no histórico.</p>
                </div>
              )}

              {suggestions && (
                <div className="rounded-xl border border-copper/40 bg-accent/40 p-3">
                  <div className="text-sm font-medium">Horário liberado · lista de espera</div>
                  {suggestions.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">Ninguém da lista de espera combina com esse horário.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {suggestions.map((s) => (
                        <div key={s.waitlist_id} className="flex items-center justify-between gap-2 rounded-lg bg-card p-2 text-sm">
                          <div>
                            <div className="font-medium">{s.client_name}</div>
                            <div className="text-xs text-muted-foreground">{s.service_id ? svc(s.service_id)?.name : "Qualquer serviço"} · {formatPhone(s.client_phone)}</div>
                          </div>
                          <Button size="sm" onClick={() => onBook({
                            day: dayKey(appt.starts_at, tz),
                            time: fmtTime(appt.starts_at, tz),
                            professional_id: s.professional_id ?? appt.items?.[0]?.professional_id,
                            client: { id: s.client_id, name: s.client_name, phone: s.client_phone },
                          }, s.waitlist_id)}>Agendar</Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {manage ? (
                <div className="space-y-2">
                  <Label>Observação</Label>
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  {notes !== (appt.notes ?? "") && (
                    <Button size="sm" variant="outline" onClick={() => saveNotes.mutate({ id: appt.id, notes }, { onSuccess: () => toast.success("Observação salva") })}>Salvar observação</Button>
                  )}
                </div>
              ) : (
                appt.notes && <p className="rounded-xl bg-muted p-3 text-sm">{appt.notes}</p>
              )}
              {role === "profissional" && <p className="text-xs text-muted-foreground">Para remarcar ou cancelar, fale com a recepção.</p>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
