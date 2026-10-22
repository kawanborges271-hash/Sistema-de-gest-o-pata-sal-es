import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlarmClock, ArrowDownLeft, ArrowUpRight, KanbanSquare, Plus, Target, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { LeadDialog } from "@/components/crm/LeadDialog";
import { LeadSheet } from "@/components/crm/LeadSheet";
import { LostReasonDialog } from "@/components/crm/LostReasonDialog";
import { AppointmentDialog, type AppointmentDefaults } from "@/components/agenda/AppointmentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useLeads, useLeadsCreatedSince, useMoveLead } from "@/hooks/useCrm";
import { CLIENT_ORIGIN_LABEL } from "@/lib/agenda";
import { LEAD_STAGE_DOT, LEAD_STAGE_LABEL, LEAD_STAGES, OPEN_STAGES } from "@/lib/crm";
import { errorMessage } from "@/lib/errors";
import { EMPTY, formatPhone, num, timeAgo } from "@/lib/format";
import { fmt, todayKey } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { ClientOrigin, Lead, LeadStage } from "@/lib/types";

const DONE_STAGES: LeadStage[] = ["cliente", "perdido", "base_fria"];

export default function Crm() {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const [params, setParams] = useSearchParams();
  const { data: leads = [], isLoading } = useLeads();
  const since = useMemo(() => new Date(Date.now() - 30 * 86400_000).toISOString(), []);
  const { data: recent = [] } = useLeadsCreatedSince(since);
  const move = useMoveLead();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [origin, setOrigin] = useState<ClientOrigin | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [lostFor, setLostFor] = useState<Lead | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // o dragover chega antes do re-render; o ref já tem o id
  const dragRef = useRef<string | null>(null);
  const [overStage, setOverStage] = useState<LeadStage | null>(null);
  const [booking, setBooking] = useState<AppointmentDefaults | null>(null);

  // ?lead=id (sino de notificações)
  useEffect(() => {
    const id = params.get("lead");
    if (id) {
      setOpenId(id);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const now = new Date();
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return leads.filter((l) =>
      (origin === "all" || l.origin === origin)
      && (!q || l.name.toLowerCase().includes(q) || (digits.length >= 3 && l.phone?.includes(digits)) || l.interest?.toLowerCase().includes(q)));
  }, [leads, search, origin]);

  const byStage = useMemo(() => {
    const m = Object.fromEntries(LEAD_STAGES.map((s) => [s, [] as Lead[]])) as Record<LeadStage, Lead[]>;
    for (const l of filtered) m[l.stage].push(l);
    return m;
  }, [filtered]);

  const open = leads.filter((l) => OPEN_STAGES.includes(l.stage)).length;
  const overdue = leads.filter((l) => l.next_follow_up_at && new Date(l.next_follow_up_at) < now && !DONE_STAGES.includes(l.stage)).length;
  const converted = recent.filter((l) => l.converted_at).length;
  const conversion = recent.length ? `${Math.round((converted / recent.length) * 100)}%` : EMPTY;

  const drop = async (stage: LeadStage) => {
    const lead = leads.find((l) => l.id === dragRef.current);
    dragRef.current = null;
    setDragId(null);
    setOverStage(null);
    if (!lead || lead.stage === stage) return;
    if (stage === "perdido") return setLostFor(lead);
    try {
      await move.mutateAsync({ id: lead.id, stage });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const openLead = leads.find((l) => l.id === openId) ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Operação · CRM"
        title="Cada conversa, até virar cliente."
        subtitle="Mensagem nova no WhatsApp e reserva pelo link entram sozinhas. Depois do primeiro agendamento, o card anda com a agenda."
        actions={<Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" /> Novo lead</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Leads em andamento" value={num(open)} formula="Novo + Em contato + Agendado + Follow-up + Não compareceu" icon={Users} highlight />
        <KpiCard label="Follow-ups atrasados" value={num(overdue)} formula="Data do próximo follow-up já passou" icon={AlarmClock} />
        <KpiCard label="Conversão em cliente" value={conversion} formula={`Viraram cliente ÷ leads dos últimos 30 dias (${converted} de ${recent.length})`} icon={Target} />
      </div>

      {leads.length === 0 && !isLoading ? (
        <EmptyState icon={KanbanSquare} title="Nenhum lead ainda"
          description="Conecte o WhatsApp em Configurações: toda mensagem de um número novo vira um card aqui. Reservas pelo link de agendamento também entram sozinhas."
          action={<Button onClick={() => setNewOpen(true)}><Plus className="mr-1 h-4 w-4" /> Criar lead manualmente</Button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input placeholder="Buscar por nome, telefone ou interesse…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full sm:w-80" />
            <Select value={origin} onValueChange={(v) => setOrigin(v as ClientOrigin | "all")}>
              <SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as origens</SelectItem>
                {(Object.keys(CLIENT_ORIGIN_LABEL) as ClientOrigin[]).map((o) => <SelectItem key={o} value={o}>{CLIENT_ORIGIN_LABEL[o]}</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="ml-auto hidden text-xs text-muted-foreground md:inline">Arraste os cards entre as colunas, ou abra o card para mudar a etapa.</span>
          </div>

          <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8 lg:-mx-10 lg:px-10">
            <div className="flex min-w-max snap-x gap-3">
              {LEAD_STAGES.map((stage) => (
                <section key={stage}
                  onDragOver={(e) => { if (dragRef.current) { e.preventDefault(); setOverStage(stage); } }}
                  onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                  onDrop={(e) => { e.preventDefault(); drop(stage); }}
                  aria-label={LEAD_STAGE_LABEL[stage]}
                  className={cn("flex w-72 shrink-0 snap-start flex-col rounded-2xl border border-border bg-muted/40 transition-colors",
                    overStage === stage && "border-copper bg-accent/60")}>
                  <header className="flex items-center gap-2 px-3 pb-2 pt-3">
                    <span className={cn("h-2 w-2 rounded-full", LEAD_STAGE_DOT[stage])} />
                    <h2 className="text-sm font-medium">{LEAD_STAGE_LABEL[stage]}</h2>
                    <span className="ml-auto rounded-full bg-card px-2 text-xs text-muted-foreground">{byStage[stage].length}</span>
                  </header>
                  <div className="flex max-h-[62vh] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
                    {byStage[stage].map((l) => {
                      const late = l.next_follow_up_at && new Date(l.next_follow_up_at) < now && !DONE_STAGES.includes(l.stage);
                      return (
                        <article key={l.id} draggable
                          onDragStart={(e) => { dragRef.current = l.id; setDragId(l.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.id); }}
                          onDragEnd={() => { dragRef.current = null; setDragId(null); setOverStage(null); }}
                          onClick={() => setOpenId(l.id)}
                          className={cn("cursor-pointer rounded-xl border border-border bg-card p-3 shadow-soft transition hover:border-foreground/20",
                            dragId === l.id && "opacity-50")}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{l.name}</div>
                              <div className="text-xs text-muted-foreground">{l.phone ? formatPhone(l.phone) : "sem telefone"}</div>
                            </div>
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{CLIENT_ORIGIN_LABEL[l.origin]}</span>
                          </div>
                          {l.interest && <div className="mt-2 text-xs font-medium text-accent-foreground">{l.interest}</div>}
                          {l.last_message && (
                            <p className="mt-1.5 line-clamp-2 text-xs text-foreground/75">
                              {l.last_message_direction === "in"
                                ? <ArrowDownLeft className="mr-0.5 inline h-3 w-3 text-success" />
                                : <ArrowUpRight className="mr-0.5 inline h-3 w-3 text-muted-foreground" />}
                              {l.last_message}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span>{timeAgo(l.last_message_at ?? l.stage_changed_at, now)}</span>
                            {l.next_follow_up_at && !DONE_STAGES.includes(l.stage) && (
                              <span className={cn("ml-auto rounded-full px-2 py-0.5", late ? "bg-destructive/10 text-destructive" : "bg-muted")}>
                                {late ? "atrasado · " : ""}follow-up {fmt(l.next_follow_up_at, todayKey(tz) === fmt(l.next_follow_up_at, "yyyy-MM-dd", tz) ? "HH:mm" : "dd/MM", tz)}
                              </span>
                            )}
                            {l.stage === "perdido" && l.lost_reason && <span className="ml-auto truncate">{l.lost_reason}</span>}
                          </div>
                        </article>
                      );
                    })}
                    {byStage[stage].length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nenhum card</p>}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      )}

      <LeadDialog open={newOpen} onOpenChange={setNewOpen} onCreated={setOpenId} />
      <LeadSheet lead={openLead} onOpenChange={(o) => !o && setOpenId(null)} onAskLost={setLostFor}
        onSchedule={(clientId, name, phone) => {
          setOpenId(null);
          setBooking({ day: todayKey(tz), time: "10:00", client: { id: clientId, name, phone } });
        }} />
      <LostReasonDialog open={Boolean(lostFor)} name={lostFor?.name ?? ""} onCancel={() => setLostFor(null)}
        onConfirm={async (reason) => {
          const l = lostFor!;
          setLostFor(null);
          try {
            await move.mutateAsync({ id: l.id, stage: "perdido", lostReason: reason });
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }} />
      <AppointmentDialog open={Boolean(booking)} onOpenChange={(o) => !o && setBooking(null)} defaults={booking ?? { day: todayKey(tz), time: "10:00" }}
        onCreated={() => {
          setBooking(null);
          qc.invalidateQueries({ queryKey: ["leads"] });
          toast.success("Agendado. O card foi para \"Agendado\".");
        }} />
    </div>
  );
}
