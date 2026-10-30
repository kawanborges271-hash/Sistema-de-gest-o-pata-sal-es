import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Ban, CalendarDays, ChevronLeft, ChevronRight, Hourglass, Plus, SlidersHorizontal, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/common/PageHeader";
import { EmptyState } from "@/components/common/EmptyState";
import { TimeGrid, type GridColumn, type GridItem } from "@/components/agenda/TimeGrid";
import { MonthView, monthGridRange } from "@/components/agenda/MonthView";
import { ListView } from "@/components/agenda/ListView";
import { AgendaCards } from "@/components/agenda/AgendaCards";
import { AppointmentDialog, type AppointmentDefaults } from "@/components/agenda/AppointmentDialog";
import { AppointmentSheet } from "@/components/agenda/AppointmentSheet";
import { BlockDialog } from "@/components/agenda/BlockDialog";
import { WaitlistDialog } from "@/components/agenda/WaitlistDialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBlocks, useProfessionalHours, useProfessionalServices, useProfessionals, useServices } from "@/hooks/useCatalog";
import { useAppointments, useReschedule, useSaveWaitlist } from "@/hooks/useAgenda";
import { BLOCK_LABEL, STATUS_LABEL, STATUS_ORDER } from "@/lib/agenda";
import { CONFLICT_MESSAGE, errorMessage, scheduleConflict } from "@/lib/errors";
import {
  addDaysKey, dayKey, hhmmToMinutes, isoWeekday, labelDay, minutesOfDay, minutesToHhmm, startOfWeekKey, todayKey, zonedToUtc,
} from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Appointment, AppointmentStatus } from "@/lib/types";

type View = "dia" | "semana" | "mes" | "lista";
const HIDDEN_BY_DEFAULT: AppointmentStatus[] = ["cancelado", "reagendado"];

export default function Agenda() {
  const { salon, role, professionalId } = useAuth();
  const tz = salon!.timezone;
  const { can } = usePermissions();
  const manage = can("agenda.gerenciar");
  const [params, setParams] = useSearchParams();
  const isMobile = useIsMobile();

  const today = todayKey(tz);
  const [view, setView] = useState<View>("dia");
  const [day, setDay] = useState(today);
  const [proFilter, setProFilter] = useState<string>(role === "profissional" && professionalId ? professionalId : "all");
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const [createOpen, setCreateOpen] = useState(false);
  const [defaults, setDefaults] = useState<AppointmentDefaults>({ day: today, time: "09:00" });
  const [waitlistBooking, setWaitlistBooking] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // ?agendamento=id (busca global)
  useEffect(() => {
    const id = params.get("agendamento");
    if (id) {
      setSheetId(id);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const range = useMemo(() => {
    if (view === "dia") return { start: day, end: addDaysKey(day, 1) };
    if (view === "mes") return monthGridRange(day);
    const s = startOfWeekKey(day);
    return { start: s, end: addDaysKey(s, 7) };
  }, [view, day]);
  const fromIso = zonedToUtc(range.start, "00:00", tz).toISOString();
  const toIso = zonedToUtc(range.end, "00:00", tz).toISOString();

  const { data: appointments = [], isLoading } = useAppointments(fromIso, toIso);
  const { data: blocks = [] } = useBlocks(fromIso, toIso);
  const { data: pros = [] } = useProfessionals();
  const { data: services = [] } = useServices();
  const { data: hours = [] } = useProfessionalHours();
  const { data: links = [] } = useProfessionalServices();
  const reschedule = useReschedule();
  const saveWaitlist = useSaveWaitlist();

  const activePros = pros.filter((p) => p.active && (proFilter === "all" || p.id === proFilter));
  const proById = (id: string) => pros.find((p) => p.id === id);
  const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? "Serviço";

  const visible = useMemo(
    () =>
      appointments.filter((a) => {
        if (statusFilter) return a.status === statusFilter;
        if (!showCancelled && HIDDEN_BY_DEFAULT.includes(a.status)) return false;
        if (proFilter !== "all" && !(a.items ?? []).some((i) => i.professional_id === proFilter)) return false;
        return true;
      }),
    [appointments, statusFilter, showCancelled, proFilter],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUS_ORDER.map((s) => [s, 0])) as Record<AppointmentStatus, number>;
    for (const a of appointments) {
      if (proFilter !== "all" && !(a.items ?? []).some((i) => i.professional_id === proFilter)) continue;
      c[a.status]++;
    }
    return c;
  }, [appointments, proFilter]);

  // Janela de horas: jornadas + horário do salão + itens fora do padrão
  const [startMin, endMin] = useMemo(() => {
    let lo = 8 * 60;
    let hi = 20 * 60;
    const ranges = [
      ...hours.map((h) => [hhmmToMinutes(h.start_time), hhmmToMinutes(h.end_time)]),
      ...Object.values(salon!.business_hours ?? {}).flat().map(([s, e]) => [hhmmToMinutes(s), hhmmToMinutes(e)]),
    ];
    if (ranges.length) {
      lo = Math.min(...ranges.map((r) => r[0]));
      hi = Math.max(...ranges.map((r) => r[1]));
    }
    for (const a of visible) {
      lo = Math.min(lo, minutesOfDay(a.starts_at, tz));
      hi = Math.max(hi, dayKey(a.ends_at, tz) === dayKey(a.starts_at, tz) ? minutesOfDay(a.ends_at, tz) : 24 * 60);
    }
    return [Math.floor(lo / 60) * 60, Math.min(24 * 60, Math.ceil(hi / 60) * 60)];
  }, [hours, salon, visible, tz]);

  const blockRanges = (d: string, proId: string | null) =>
    blocks
      .filter((b) => b.professional_id === null || b.professional_id === proId)
      .filter((b) => dayKey(b.starts_at, tz) <= d && dayKey(b.ends_at, tz) >= d)
      .map((b) => ({
        start: dayKey(b.starts_at, tz) < d ? 0 : minutesOfDay(b.starts_at, tz),
        end: dayKey(b.ends_at, tz) > d ? 24 * 60 : minutesOfDay(b.ends_at, tz),
        label: b.reason || BLOCK_LABEL[b.kind],
      }));

  const availability = (proId: string | null, d: string): { available: [number, number][]; hasHours: boolean } => {
    const wd = isoWeekday(d);
    if (proId) {
      const mine = hours.filter((h) => h.professional_id === proId);
      return {
        hasHours: mine.length > 0,
        available: mine.filter((h) => h.weekday === wd).map((h) => [hhmmToMinutes(h.start_time), hhmmToMinutes(h.end_time)]),
      };
    }
    const bh = salon!.business_hours?.[String(wd)];
    const has = Object.keys(salon!.business_hours ?? {}).length > 0;
    return { hasHours: has, available: (bh ?? []).map(([s, e]) => [hhmmToMinutes(s), hhmmToMinutes(e)]) };
  };

  const columns: GridColumn[] = useMemo(() => {
    if (view === "dia") {
      return activePros.map((p) => ({
        key: p.id, label: p.name, sub: p.role_title ?? undefined, color: p.color, day, professionalId: p.id,
        isToday: day === today, blocks: blockRanges(day, p.id), ...availability(p.id, day),
      }));
    }
    const single = proFilter !== "all" ? proFilter : null;
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDaysKey(range.start, i);
      return {
        key: d, label: labelDay(d, "EEE dd/MM"), day: d, professionalId: single, isToday: d === today,
        blocks: blockRanges(d, single), ...availability(single, d),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, activePros, day, today, range.start, proFilter, blocks, hours, salon]);

  const gridItems: GridItem[] = useMemo(() => {
    const out: GridItem[] = [];
    for (const a of visible) {
      const apptStart = minutesOfDay(a.starts_at, tz);
      for (const it of a.items ?? []) {
        if (proFilter !== "all" && it.professional_id !== proFilter) continue;
        const p = proById(it.professional_id);
        const start = minutesOfDay(it.starts_at, tz);
        const end = dayKey(it.ends_at, tz) === dayKey(it.starts_at, tz) ? minutesOfDay(it.ends_at, tz) : 24 * 60;
        out.push({
          id: it.id,
          appointmentId: a.id,
          columnKey: view === "dia" ? it.professional_id : dayKey(it.starts_at, tz),
          start,
          end,
          offset: start - apptStart,
          color: p?.color ?? "#999",
          title: a.client?.name ?? "Cliente",
          subtitle: `${minutesToHhmm(start)} ${svcName(it.service_id)}${view !== "dia" && proFilter === "all" ? ` · ${p?.name ?? ""}` : ""}`,
          status: a.status,
          squeeze: it.is_squeeze,
          draggable: manage && (a.status === "agendado" || a.status === "confirmado"),
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, view, proFilter, pros, services, tz, manage]);

  const openCreate = (d: AppointmentDefaults) => {
    setDefaults(d);
    setCreateOpen(true);
  };

  const onSlotClick = (col: GridColumn, minute: number) => {
    if (!manage) return;
    openCreate({ day: col.day, time: minutesToHhmm(minute), professional_id: col.professionalId ?? (proFilter !== "all" ? proFilter : null) });
  };

  const onDropItem = async (apptId: string, offset: number, col: GridColumn, minute: number, squeeze = false) => {
    const appt = appointments.find((a) => a.id === apptId) as Appointment | undefined;
    if (!appt) return;
    const startMinute = Math.max(0, minute - offset);
    const target = zonedToUtc(col.day, minutesToHhmm(startMinute), tz).toISOString();
    const proIds = new Set((appt.items ?? []).map((i) => i.professional_id));
    const changePro = view === "dia" && col.professionalId && !proIds.has(col.professionalId);
    if (changePro && proIds.size > 1) {
      toast.error("Agendamento com mais de um profissional: remarque pelo detalhe.");
      return;
    }
    if (changePro) {
      const missing = (appt.items ?? []).find(
        (i) => !links.some((l) => l.professional_id === col.professionalId && l.service_id === i.service_id),
      );
      if (missing) {
        toast.error(`${proById(col.professionalId!)?.name} não faz ${svcName(missing.service_id)}.`);
        return;
      }
    }
    if (target === appt.starts_at && !changePro) return;
    try {
      const newId = await reschedule.mutateAsync({ id: appt.id, starts_at: target, professional_id: changePro ? col.professionalId : null, squeeze });
      toast.success(`Remarcado para ${labelDay(col.day, "dd/MM")} às ${minutesToHhmm(startMinute)}`, {
        action: { label: "Ver", onClick: () => setSheetId(newId) },
      });
    } catch (err) {
      const c = scheduleConflict(err);
      if (c) {
        toast.warning(CONFLICT_MESSAGE[c], {
          action: { label: "Encaixar mesmo assim", onClick: () => onDropItem(apptId, offset, col, minute, true) },
        });
      } else toast.error(errorMessage(err));
    }
  };

  const step = (dir: -1 | 1) => {
    if (view === "dia") setDay(addDaysKey(day, dir));
    else if (view === "mes") {
      const [y, m] = day.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      setDay(d.toISOString().slice(0, 10));
    } else setDay(addDaysKey(day, 7 * dir));
  };

  const title =
    view === "dia" ? labelDay(day)
      : view === "mes" ? labelDay(day, "MMMM 'de' yyyy")
      : `${labelDay(range.start, "dd/MM")} a ${labelDay(addDaysKey(range.end, -1), "dd/MM")}`;

  const noPros = !isLoading && pros.filter((p) => p.active).length === 0;

  const dialogs = (
    <>
        <AppointmentDialog
          open={createOpen}
          onOpenChange={(o) => { setCreateOpen(o); if (!o) setWaitlistBooking(null); }}
          defaults={defaults}
          onCreated={(id) => {
            if (waitlistBooking) saveWaitlist.mutate({ id: waitlistBooking, status: "agendado", appointment_id: id });
            setWaitlistBooking(null);
            setSheetId(id);
          }}
        />
        <AppointmentSheet
          id={sheetId}
          onOpenChange={(o) => !o && setSheetId(null)}
          onSelect={setSheetId}
          onBook={(d, waitlistId) => { setSheetId(null); setWaitlistBooking(waitlistId); openCreate(d); }}
        />
        <BlockDialog open={blockOpen} onOpenChange={setBlockOpen} day={day} professionalId={proFilter !== "all" ? proFilter : null} />
        <WaitlistDialog open={waitlistOpen} onOpenChange={setWaitlistOpen} />
    </>
  );

  // Celular: cabeçalho enxuto, cards grandes por horário e um botão + flutuante.
  if (isMobile) {
    const mobileView = view === "lista" ? "semana" : view;
    return (
      <div>
        <div className="mb-6">
          <span className="inline-block rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Agenda</span>
          <h1 className="mt-3 font-display text-[34px] font-light leading-none">Sua agenda.</h1>
          <div className="mt-3 h-px w-40 bg-copper/60" />
        </div>

        <div className="mb-4 flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={() => step(-1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={() => step(1)} aria-label="Próximo"><ChevronRight className="h-4 w-4" /></Button>
          <Button variant="outline" className="h-10 shrink-0 rounded-full px-4" onClick={() => setDay(today)}>Hoje</Button>
          <div className="min-w-0 flex-1 truncate pl-1 font-display text-lg first-letter:uppercase">
            {mobileView === "dia" ? labelDay(day, "EEE, d 'de' MMM") : title}
          </div>
          <Button variant="ghost" size="icon" className="relative h-10 w-10 shrink-0 rounded-full" onClick={() => setOptionsOpen(true)} aria-label="Filtros e opções">
            <SlidersHorizontal className="h-4 w-4" />
            {(proFilter !== "all" && role !== "profissional" || showCancelled || statusFilter) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-copper" />}
          </Button>
        </div>

        <Tabs value={mobileView} onValueChange={(v) => setView(v as View)} className="mb-5">
          <TabsList className="h-11 w-full rounded-full p-1">
            <TabsTrigger value="dia" className="flex-1 rounded-full">Dia</TabsTrigger>
            <TabsTrigger value="semana" className="flex-1 rounded-full">Semana</TabsTrigger>
            <TabsTrigger value="mes" className="flex-1 rounded-full">Mês</TabsTrigger>
          </TabsList>
        </Tabs>

        {noPros ? (
          <EmptyState icon={UserCog} title="A agenda precisa de profissionais"
            description="Cadastre quem atende, com serviços e jornada."
            action={can("profissionais.editar") && <Button asChild><a href="/profissionais">Cadastrar profissionais</a></Button>} />
        ) : mobileView === "mes" ? (
          <MonthView day={day} today={today} appointments={visible} tz={tz} onPickDay={(d) => { setDay(d); setView("dia"); }} />
        ) : isLoading ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted" />)}</div>
        ) : (
          <AgendaCards appointments={visible} services={services} pros={pros} tz={tz} groupByDay={mobileView === "semana"} onOpen={setSheetId} />
        )}

        {manage && (
          <button
            type="button"
            onClick={() => openCreate({ day, time: "09:00", professional_id: proFilter !== "all" ? proFilter : null })}
            className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
            aria-label="Novo agendamento"
          >
            <Plus className="h-6 w-6" />
          </button>
        )}

        <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
          <SheetContent side="bottom" className="rounded-t-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            <SheetHeader><SheetTitle>Filtros e opções</SheetTitle></SheetHeader>
            <div className="mt-5 space-y-5">
              {role !== "profissional" && (
                <div className="space-y-2">
                  <div className="label-caps">Profissional</div>
                  <Select value={proFilter} onValueChange={setProFilter}>
                    <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os profissionais</SelectItem>
                      {pros.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <div className="label-caps">Status</div>
                <div className="flex flex-wrap gap-2">
                  {STATUS_ORDER.map((s) => (
                    <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
                      className={cn("rounded-full border px-3 py-1.5 text-xs transition-colors",
                        statusFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>
                      {STATUS_LABEL[s]} · {counts[s]}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between text-sm">
                Mostrar cancelados
                <Switch checked={showCancelled} onCheckedChange={setShowCancelled} />
              </label>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" className="h-11" onClick={() => { setOptionsOpen(false); setBlockOpen(true); }}><Ban className="mr-1 h-4 w-4" /> Bloquear</Button>
                {manage && <Button variant="outline" className="h-11" onClick={() => { setOptionsOpen(false); setWaitlistOpen(true); }}><Hourglass className="mr-1 h-4 w-4" /> Lista de espera</Button>}
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {dialogs}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Operação · Agenda"
        title="Seu salão, hora a hora."
        subtitle={role === "profissional" ? "Sua agenda de atendimentos. Toque em um horário para ver detalhes e marcar o andamento." : "Clique num horário livre para agendar e arraste para remarcar. A agenda respeita jornada, intervalos e bloqueios."}
        actions={
          <>
            {manage && <Button variant="outline" onClick={() => setWaitlistOpen(true)}><Hourglass className="mr-1 h-4 w-4" /> Lista de espera</Button>}
            <Button variant="outline" onClick={() => setBlockOpen(true)}><Ban className="mr-1 h-4 w-4" /> Bloquear</Button>
            {manage && <Button onClick={() => openCreate({ day, time: "09:00", professional_id: proFilter !== "all" ? proFilter : null })}><Plus className="mr-1 h-4 w-4" /> Novo agendamento</Button>}
          </>
        }
      />

      {/* contadores por status */}
      <div className="mb-5 flex gap-2 overflow-x-auto pb-1">
        {STATUS_ORDER.map((s) => (
          <button key={s} onClick={() => setStatusFilter(statusFilter === s ? null : s)}
            className={cn("shrink-0 rounded-2xl border px-4 py-2.5 text-left transition-colors",
              statusFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
            <div className={cn("text-[10px] uppercase tracking-[0.14em]", statusFilter === s ? "text-primary-foreground/70" : "text-muted-foreground")}>{STATUS_LABEL[s]}</div>
            <div className="font-display text-xl">{counts[s]}</div>
          </button>
        ))}
      </div>

      {/* barra de controle */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList>
            <TabsTrigger value="dia">Dia</TabsTrigger>
            <TabsTrigger value="semana">Semana</TabsTrigger>
            <TabsTrigger value="mes">Mês</TabsTrigger>
            <TabsTrigger value="lista">Lista</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => step(-1)} aria-label="Anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="outline" className="h-9" onClick={() => setDay(today)}>Hoje</Button>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => step(1)} aria-label="Próximo"><ChevronRight className="h-4 w-4" /></Button>
          <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="ml-1 h-9 rounded-md border border-input bg-card px-2 text-sm" aria-label="Escolher data" />
        </div>
        <div className="font-display text-lg first-letter:uppercase">{title}</div>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={showCancelled} onCheckedChange={setShowCancelled} /> Cancelados
          </label>
          {role !== "profissional" && (
            <Select value={proFilter} onValueChange={setProFilter}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os profissionais</SelectItem>
                {pros.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {noPros ? (
        <EmptyState icon={UserCog} title="A agenda precisa de profissionais"
          description="Cadastre quem atende, com serviços e jornada. Cada profissional vira uma coluna na visão Dia."
          action={can("profissionais.editar") && <Button asChild><a href="/profissionais">Cadastrar profissionais</a></Button>} />
      ) : view === "mes" ? (
        <MonthView day={day} today={today} appointments={visible} tz={tz} onPickDay={(d) => { setDay(d); setView("dia"); }} />
      ) : view === "lista" ? (
        <ListView appointments={visible.filter((a) => dayKey(a.starts_at, tz) >= range.start)} services={services} pros={pros} tz={tz} onOpen={setSheetId} />
      ) : (
        <>
          <TimeGrid
            columns={columns}
            items={gridItems}
            startMin={startMin}
            endMin={endMin}
            nowMin={minutesOfDay(now, tz)}
            minColWidth={view === "dia" ? 170 : 130}
            onSlotClick={onSlotClick}
            onItemClick={setSheetId}
            onDropItem={manage ? onDropItem : undefined}
          />
          {view === "dia" && visible.length === 0 && !isLoading && (
            <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" /> Nenhum horário marcado neste dia.{manage && " Clique num espaço livre para agendar."}
            </p>
          )}
        </>
      )}

      {dialogs}
    </div>
  );
}
