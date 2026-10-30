import { CalendarDays } from "lucide-react";
import { EmptyState } from "@/components/common/EmptyState";
import { STATUS_LABEL, STATUS_STYLE } from "@/lib/agenda";
import { dayKey, fmtTime, labelDay } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Appointment, Professional, Service } from "@/lib/types";

/** Agenda no celular: um card por horário, só o que importa para bater o olho. */
export function AgendaCards({ appointments, services, pros, tz, groupByDay, onOpen }: {
  appointments: Appointment[];
  services: Service[];
  pros: Professional[];
  tz: string;
  groupByDay?: boolean;
  onOpen: (id: string) => void;
}) {
  if (!appointments.length) {
    return <EmptyState icon={CalendarDays} title="Nenhum horário marcado" description="Toque no + para agendar ou mude o dia no topo." />;
  }
  const groups = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const k = groupByDay ? dayKey(a.starts_at, tz) : "";
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return (
    <div className="space-y-6">
      {[...groups.entries()].map(([d, list]) => (
        <section key={d}>
          {groupByDay && <div className="label-caps mb-3 first-letter:uppercase">{labelDay(d, "EEEE, d 'de' MMM")}</div>}
          <div className="space-y-3">
            {list.map((a) => <AgendaCard key={a.id} appt={a} services={services} pros={pros} tz={tz} onOpen={onOpen} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function AgendaCard({ appt, services, pros, tz, onOpen }: {
  appt: Appointment;
  services: Service[];
  pros: Professional[];
  tz: string;
  onOpen: (id: string) => void;
}) {
  const items = appt.items ?? [];
  const first = items[0];
  const service = first ? services.find((s) => s.id === first.service_id)?.name ?? "Serviço" : "Serviço";
  const pro = first ? pros.find((p) => p.id === first.professional_id) : undefined;
  const color = pro?.color ?? "#B87A5E";
  const faded = appt.status === "cancelado" || appt.status === "reagendado";

  return (
    <button
      type="button"
      onClick={() => onOpen(appt.id)}
      className={cn(
        "flex w-full items-center gap-4 rounded-2xl border border-border/60 py-4 pl-5 pr-3 text-left shadow-soft transition-transform active:scale-[0.99]",
        faded && "opacity-60",
      )}
      style={{
        borderLeft: `4px solid ${color}`,
        background: `color-mix(in srgb, ${color} 7%, hsl(var(--card)))`,
      }}
    >
      <div className="w-[4.5rem] shrink-0 text-center">
        <div className="font-display text-[26px] leading-none">{fmtTime(appt.starts_at, tz)}</div>
        <div className="mt-1.5 text-xs text-muted-foreground">até {fmtTime(appt.ends_at, tz)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{appt.client?.name ?? "Cliente"}</div>
        <div className="truncate text-sm text-muted-foreground">
          {service}{items.length > 1 && ` +${items.length - 1}`}
        </div>
        {pro && (
          <div className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate">{pro.name}</span>
          </div>
        )}
      </div>
      <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium", STATUS_STYLE[appt.status])}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {STATUS_LABEL[appt.status]}
      </span>
    </button>
  );
}
