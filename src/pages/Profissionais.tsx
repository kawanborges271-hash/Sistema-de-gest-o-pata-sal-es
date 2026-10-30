import { useState } from "react";
import { Clock, Plus, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { ProfessionalDialog } from "@/components/profissionais/ProfessionalDialog";
import { useProfessionalHours, useProfessionalServices, useProfessionals } from "@/hooks/useCatalog";
import { usePermissions } from "@/hooks/usePermissions";
import { initials, num } from "@/lib/format";
import { hhmmToMinutes, WEEKDAYS } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Professional } from "@/lib/types";

export default function Profissionais() {
  const { data: pros = [], isLoading } = useProfessionals();
  const { data: ps = [] } = useProfessionalServices();
  const { data: hours = [] } = useProfessionalHours();
  const { can } = usePermissions();
  const editable = can("profissionais.editar");
  const [editing, setEditing] = useState<Professional | null>(null);
  const [open, setOpen] = useState(false);

  const active = pros.filter((p) => p.active);
  const weeklyHours = (id: string) =>
    hours.filter((h) => h.professional_id === id).reduce((a, h) => a + hhmmToMinutes(h.end_time) - hhmmToMinutes(h.start_time), 0) / 60;
  const totalHours = active.reduce((a, p) => a + weeklyHours(p.id), 0);

  const openNew = () => { setEditing(null); setOpen(true); };

  return (
    <div>
      <PageHeader
        eyebrow="Cadastros · Profissionais"
        title="Quem atende, o que faz e quando está no salão."
        subtitle="A jornada e os serviços de cada profissional definem os horários livres da agenda."
        actions={editable && <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Novo profissional</Button>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Profissionais ativos" value={num(active.length)} formula="Profissionais marcados como ativos" icon={UserCog} highlight />
        <KpiCard label="Horas por semana" value={totalHours ? `${num(Math.round(totalHours))}h` : "—"} formula="Soma das jornadas dos ativos" icon={Clock} />
        <KpiCard label="Serviços por profissional" value={active.length ? num(Math.round(ps.filter((p) => active.some((a) => a.id === p.professional_id)).length / active.length)) : "—"} formula="Vínculos serviço × profissional ÷ ativos" />
      </div>

      {pros.length === 0 && !isLoading ? (
        <EmptyState icon={UserCog} title="Nenhum profissional cadastrado"
          description="Cadastre quem atende, com serviços e jornada, para a agenda ganhar colunas."
          action={editable && <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Cadastrar profissional</Button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pros.map((p) => {
            const days = WEEKDAYS.filter((d) => hours.some((h) => h.professional_id === p.id && h.weekday === d.iso));
            return (
              <button key={p.id} disabled={!editable} onClick={() => { setEditing(p); setOpen(true); }}
                className={cn("rounded-2xl border border-border bg-card p-5 text-left shadow-soft transition-shadow enabled:hover:shadow-elev", !p.active && "opacity-55")}>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-full text-sm font-semibold text-white" style={{ background: p.color }}>{initials(p.name)}</span>
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.role_title || "Sem cargo"}{!p.active && " · inativo"}</div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-1">
                  {WEEKDAYS.map((d) => (
                    <span key={d.iso} className={cn("rounded-md px-1.5 py-0.5 text-[10px]", days.includes(d) ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground/60")}>{d.short}</span>
                  ))}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {ps.filter((x) => x.professional_id === p.id).length} serviços · {num(Math.round(weeklyHours(p.id)))}h/semana{p.default_commission_pct !== undefined && ` · comissão ${num(Number(p.default_commission_pct))}%`}
                  {p.user_id && " · tem login"}
                </div>
              </button>
            );
          })}
        </div>
      )}
      <ProfessionalDialog open={open} onOpenChange={setOpen} professional={editing} />
    </div>
  );
}
