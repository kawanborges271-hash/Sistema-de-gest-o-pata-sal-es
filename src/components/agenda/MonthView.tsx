import { cn } from "@/lib/utils";
import { addDaysKey, dayKey, labelDay, startOfWeekKey, WEEKDAYS } from "@/lib/tz";
import { ACTIVE_STATUSES } from "@/lib/agenda";
import type { Appointment } from "@/lib/types";

export function monthGridRange(day: string) {
  const first = `${day.slice(0, 7)}-01`;
  const start = startOfWeekKey(first);
  return { start, end: addDaysKey(start, 42) };
}

export function MonthView({ day, today, appointments, tz, onPickDay }: {
  day: string;
  today: string;
  appointments: Appointment[];
  tz: string;
  onPickDay: (d: string) => void;
}) {
  const { start } = monthGridRange(day);
  const month = day.slice(0, 7);
  const byDay = new Map<string, Appointment[]>();
  for (const a of appointments) {
    if (!ACTIVE_STATUSES.includes(a.status)) continue;
    const k = dayKey(a.starts_at, tz);
    byDay.set(k, [...(byDay.get(k) ?? []), a]);
  }
  const max = Math.max(1, ...[...byDay.values()].map((l) => l.length));

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((w) => <div key={w.iso} className="px-2 py-2 text-center text-[11px] uppercase tracking-wider text-muted-foreground">{w.short}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 42 }, (_, i) => {
          const d = addDaysKey(start, i);
          const list = byDay.get(d) ?? [];
          const inMonth = d.slice(0, 7) === month;
          return (
            <button key={d} onClick={() => onPickDay(d)}
              className={cn("min-h-[92px] border-b border-r border-border p-2 text-left transition-colors hover:bg-muted/60 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-muted/30 text-muted-foreground")}>
              <div className={cn("inline-grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs", d === today && "bg-primary text-primary-foreground")}>
                {Number(d.slice(8))}
              </div>
              {list.length > 0 && (
                <div className="mt-1.5">
                  <div className="h-1.5 rounded-full bg-muted">
                    <div className="h-1.5 rounded-full bg-copper" style={{ width: `${(list.length / max) * 100}%` }} />
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{list.length} {list.length === 1 ? "horário" : "horários"}</div>
                  <div className="hidden md:block">
                    {list.slice(0, 2).map((a) => <div key={a.id} className="truncate text-[11px]">{a.client?.name}</div>)}
                  </div>
                </div>
              )}
              <span className="sr-only">{labelDay(d)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
