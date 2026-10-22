import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { WEEKDAYS } from "@/lib/tz";
import type { BusinessHours } from "@/lib/types";

/** Horário de funcionamento: uma faixa por dia (abre/fecha). */
export function BusinessHoursEditor({ value, onChange }: { value: BusinessHours; onChange: (v: BusinessHours) => void }) {
  const set = (iso: number, range: [string, string] | null) => {
    const next = { ...value };
    if (range) next[String(iso)] = [range];
    else delete next[String(iso)];
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {WEEKDAYS.map((d) => {
        const r = value[String(d.iso)]?.[0];
        return (
          <div key={d.iso} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
            <Switch checked={Boolean(r)} onCheckedChange={(on) => set(d.iso, on ? ["09:00", "19:00"] : null)} />
            <span className="w-20 text-sm font-medium">{d.long}</span>
            {r ? (
              <div className="flex items-center gap-2">
                <Input type="time" value={r[0]} onChange={(e) => set(d.iso, [e.target.value, r[1]])} className="h-8 w-[110px]" />
                <span className="text-xs text-muted-foreground">às</span>
                <Input type="time" value={r[1]} onChange={(e) => set(d.iso, [r[0], e.target.value])} className="h-8 w-[110px]" />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Fechado</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  "2": [["09:00", "19:00"]], "3": [["09:00", "19:00"]], "4": [["09:00", "19:00"]],
  "5": [["09:00", "19:00"]], "6": [["09:00", "18:00"]],
};
