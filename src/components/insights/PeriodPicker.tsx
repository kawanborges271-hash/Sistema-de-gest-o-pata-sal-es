import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { addDaysKey, todayKey } from "@/lib/tz";

type Preset = "7d" | "30d" | "mes" | "90d" | "custom";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "mes", label: "Este mês" },
  { value: "90d", label: "90 dias" },
  { value: "custom", label: "Escolher" },
];

/** Período dos relatórios, no fuso do salão. Padrão: últimos 30 dias. */
export function usePeriod(tz: string) {
  const today = todayKey(tz);
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState({ from: addDaysKey(today, -29), to: today });
  const [from, to] =
    preset === "7d" ? [addDaysKey(today, -6), today]
    : preset === "30d" ? [addDaysKey(today, -29), today]
    : preset === "90d" ? [addDaysKey(today, -89), today]
    : preset === "mes" ? [`${today.slice(0, 8)}01`, today]
    : [custom.from, custom.to];
  return { preset, setPreset, custom, setCustom, from, to };
}

export type Period = ReturnType<typeof usePeriod>;

export function PeriodPicker({ period }: { period: Period }) {
  const { preset, setPreset, custom, setCustom } = period;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup type="single" value={preset} onValueChange={(v) => v && setPreset(v as Preset)} className="flex-wrap justify-start rounded-xl border border-border bg-card p-1">
        {PRESETS.map((o) => <ToggleGroupItem key={o.value} value={o.value} className="h-8 rounded-lg px-3 text-xs">{o.label}</ToggleGroupItem>)}
      </ToggleGroup>
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="De" className="h-9 w-[9.5rem]" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
          <span className="text-xs text-muted-foreground">até</span>
          <Input type="date" aria-label="Até" className="h-9 w-[9.5rem]" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
        </div>
      )}
    </div>
  );
}

export const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
