import { CalendarDays } from "lucide-react";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { money } from "@/lib/format";
import { dayKey, fmtTime, labelDay } from "@/lib/tz";
import type { Appointment, Professional, Service } from "@/lib/types";

export function ListView({ appointments, services, pros, tz, onOpen }: {
  appointments: Appointment[];
  services: Service[];
  pros: Professional[];
  tz: string;
  onOpen: (id: string) => void;
}) {
  if (!appointments.length) {
    return <EmptyState icon={CalendarDays} title="Nenhum agendamento neste período" description="Clique em Novo agendamento ou mude o período no topo." />;
  }
  const groups = new Map<string, Appointment[]>();
  for (const a of appointments) {
    const k = dayKey(a.starts_at, tz);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([d, list]) => (
        <div key={d}>
          <div className="label-caps mb-2">{labelDay(d)} · {list.length}</div>
          <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
            {list.map((a) => {
              const items = a.items ?? [];
              const total = items.reduce((s, i) => s + Number(i.price), 0);
              const names = [...new Set(items.map((i) => pros.find((p) => p.id === i.professional_id)?.name))].filter(Boolean).join(", ");
              return (
                <button key={a.id} onClick={() => onOpen(a.id)} className="w-full px-4 py-3 text-left text-sm hover:bg-muted/50">
                  {/* celular: duas linhas */}
                  <div className="md:hidden">
                    <div className="flex items-center gap-2">
                      <span className="font-display">{fmtTime(a.starts_at, tz)}</span>
                      <span className="flex-1 truncate font-medium">{a.client?.name}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {items.map((i) => services.find((s) => s.id === i.service_id)?.name).join(" + ")} · {names} · {money(total)}
                    </div>
                  </div>
                  <div className="hidden items-center gap-4 md:flex">
                    <span className="w-24 font-display">{fmtTime(a.starts_at, tz)}–{fmtTime(a.ends_at, tz)}</span>
                    <span className="min-w-[140px] flex-1 font-medium">{a.client?.name}</span>
                    <span className="min-w-[160px] flex-1 text-muted-foreground">{items.map((i) => services.find((s) => s.id === i.service_id)?.name).join(" + ")}</span>
                    <span className="w-36 truncate text-muted-foreground">{names}</span>
                    <span className="w-24 text-right">{money(total)}</span>
                    <StatusBadge status={a.status} />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
