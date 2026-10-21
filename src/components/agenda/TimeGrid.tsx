import { useMemo, type DragEvent } from "react";
import { cn } from "@/lib/utils";
import { minutesToHhmm } from "@/lib/tz";
import type { AppointmentStatus } from "@/lib/types";

export const PX_PER_MIN = 1.2;
const SNAP = 15;

export type GridColumn = {
  key: string;
  label: string;
  sub?: string;
  color?: string;
  day: string;
  professionalId: string | null;
  /** Faixas em que o profissional trabalha (min do dia). Vazio + hasHours = folga. */
  available?: [number, number][];
  hasHours?: boolean;
  blocks?: { start: number; end: number; label: string }[];
  isToday?: boolean;
};

export type GridItem = {
  id: string;
  appointmentId: string;
  columnKey: string;
  start: number;
  end: number;
  /** minutos entre o início do agendamento e o início deste item */
  offset: number;
  color: string;
  title: string;
  subtitle: string;
  status: AppointmentStatus;
  squeeze: boolean;
  draggable: boolean;
};

type Laid = GridItem & { lane: number; lanes: number };

function layout(items: GridItem[]): Laid[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Laid[] = [];
  let cluster: Laid[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    cluster.forEach((c) => (c.lanes = lanes));
    out.push(...cluster);
    cluster = [];
  };
  for (const it of sorted) {
    if (it.start >= clusterEnd && cluster.length) flush();
    const used = new Set(cluster.filter((c) => c.end > it.start).map((c) => c.lane));
    let lane = 0;
    while (used.has(lane)) lane++;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return out;
}

export function TimeGrid({
  columns, items, startMin, endMin, nowMin, minColWidth = 150,
  onSlotClick, onItemClick, onDropItem,
}: {
  columns: GridColumn[];
  items: GridItem[];
  startMin: number;
  endMin: number;
  nowMin: number | null;
  minColWidth?: number;
  onSlotClick?: (col: GridColumn, minute: number) => void;
  onItemClick: (appointmentId: string) => void;
  onDropItem?: (appointmentId: string, offset: number, col: GridColumn, minute: number) => void;
}) {
  const height = (endMin - startMin) * PX_PER_MIN;
  const hours = useMemo(() => {
    const list: number[] = [];
    for (let m = Math.ceil(startMin / 60) * 60; m < endMin; m += 60) list.push(m);
    return list;
  }, [startMin, endMin]);
  const byCol = useMemo(() => {
    const map = new Map<string, Laid[]>();
    for (const c of columns) map.set(c.key, layout(items.filter((i) => i.columnKey === c.key)));
    return map;
  }, [columns, items]);

  const minuteFromEvent = (e: { clientY: number; currentTarget: HTMLElement }, grab = 0) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const raw = (e.clientY - rect.top) / PX_PER_MIN - grab + startMin;
    return Math.max(startMin, Math.min(endMin - SNAP, Math.round(raw / SNAP) * SNAP));
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>, it: Laid) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const grab = (e.clientY - rect.top) / PX_PER_MIN;
    e.dataTransfer.setData("text/plain", JSON.stringify({ id: it.appointmentId, offset: it.offset, grab }));
    e.dataTransfer.effectAllowed = "move";
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, col: GridColumn) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData("text/plain")) as { id: string; offset: number; grab: number };
      onDropItem?.(data.id, data.offset, col, minuteFromEvent(e, data.grab));
    } catch {
      /* arrasto de outra coisa */
    }
  };

  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
      <div className="flex" style={{ minWidth: 56 + columns.length * minColWidth }}>
        {/* régua de horas */}
        <div className="w-14 shrink-0 border-r border-border">
          <div className="sticky top-0 h-14 border-b border-border bg-card" />
          <div className="relative" style={{ height }}>
            {hours.map((m) => (
              <div key={m} className="absolute right-2 -translate-y-1/2 text-[10px] text-muted-foreground" style={{ top: (m - startMin) * PX_PER_MIN }}>
                {minutesToHhmm(m)}
              </div>
            ))}
          </div>
        </div>

        {columns.map((col) => (
          <div key={col.key} className="min-w-0 flex-1 border-r border-border last:border-r-0" style={{ minWidth: minColWidth }}>
            <div className={cn("flex h-14 flex-col justify-center border-b border-border px-3", col.isToday && "bg-accent/50")}>
              <div className="flex items-center gap-2 truncate text-sm font-medium">
                {col.color && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col.color }} />}
                <span className="truncate">{col.label}</span>
              </div>
              {col.sub && <div className="truncate text-[11px] text-muted-foreground">{col.sub}</div>}
            </div>
            <div
              className="relative cursor-pointer"
              style={{ height }}
              onClick={(e) => onSlotClick?.(col, minuteFromEvent(e))}
              onDragOver={(e) => { if (onDropItem) e.preventDefault(); }}
              onDrop={(e) => onDrop(e, col)}
            >
              {/* fora da jornada */}
              {col.hasHours && (
                <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(135deg,hsl(var(--muted))_0_6px,transparent_6px_12px)] opacity-70" />
              )}
              {col.available?.map(([s, e]) => (
                <div key={s} className="pointer-events-none absolute inset-x-0 bg-card" style={{ top: (Math.max(s, startMin) - startMin) * PX_PER_MIN, height: (Math.min(e, endMin) - Math.max(s, startMin)) * PX_PER_MIN }} />
              ))}
              {/* linhas de hora */}
              {hours.map((m) => (
                <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: (m - startMin) * PX_PER_MIN }} />
              ))}
              {/* bloqueios */}
              {col.blocks?.map((b, i) => (
                <div key={i} className="pointer-events-none absolute inset-x-1 flex items-start rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-border"
                  style={{ top: (Math.max(b.start, startMin) - startMin) * PX_PER_MIN, height: Math.max(18, (Math.min(b.end, endMin) - Math.max(b.start, startMin)) * PX_PER_MIN) }}>
                  {b.label}
                </div>
              ))}
              {/* agora */}
              {col.isToday && nowMin !== null && nowMin >= startMin && nowMin <= endMin && (
                <div className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-copper" style={{ top: (nowMin - startMin) * PX_PER_MIN }}>
                  <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-copper" />
                </div>
              )}
              {byCol.get(col.key)?.map((it) => {
                const faded = it.status === "cancelado" || it.status === "reagendado" || it.status === "nao_compareceu";
                const done = it.status === "concluido";
                return (
                  <div
                    key={it.id}
                    draggable={it.draggable}
                    onDragStart={(e) => onDragStart(e, it)}
                    onClick={(e) => { e.stopPropagation(); onItemClick(it.appointmentId); }}
                    className={cn(
                      "absolute z-20 overflow-hidden rounded-lg border-l-[3px] bg-card px-2 py-1 text-left text-[11px] shadow-soft ring-1 ring-border transition hover:z-30 hover:shadow-elev",
                      it.draggable && "cursor-grab active:cursor-grabbing",
                      faded && "opacity-50",
                      done && "bg-muted",
                      it.status === "cancelado" && "line-through",
                    )}
                    style={{
                      top: (it.start - startMin) * PX_PER_MIN + 1,
                      height: Math.max(20, (it.end - it.start) * PX_PER_MIN - 2),
                      left: `calc(${(it.lane / it.lanes) * 100}% + 3px)`,
                      width: `calc(${100 / it.lanes}% - 6px)`,
                      borderLeftColor: it.color,
                      background: it.status === "confirmado" ? `color-mix(in srgb, ${it.color} 14%, hsl(var(--card)))` : undefined,
                    }}
                    title={`${it.title} · ${it.subtitle}`}
                  >
                    <div className="truncate font-semibold">{it.title}</div>
                    <div className="truncate text-muted-foreground">{it.subtitle}</div>
                    {it.squeeze && <div className="truncate text-[10px] text-warning">encaixe</div>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
