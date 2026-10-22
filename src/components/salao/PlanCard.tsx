import { SectionCard } from "@/components/common/SectionCard";
import { Progress } from "@/components/ui/progress";
import { usePlanUsage } from "@/hooks/usePlatform";
import { limitLabel, nearLimit } from "@/lib/platform";
import { cn } from "@/lib/utils";

/** Plano do salão e quanto já foi usado. Mudança de plano é com o suporte. */
export function PlanCard() {
  const { data: u } = usePlanUsage();
  if (!u) return null;
  const rows = [
    { label: "Profissionais ativos", used: u.professionals, max: u.max_professionals },
    { label: "Mensagens de WhatsApp neste mês", used: u.messages_month, max: u.max_messages_month },
  ];
  return (
    <SectionCard title={`Plano ${u.plan_name}`} hint="Para mudar de plano, fale com o suporte do Salon OS.">
      <div className="space-y-4">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-1.5 flex justify-between text-sm">
              <span>{r.label}</span>
              <span className={cn("tabular-nums", nearLimit(r.used, r.max) && "font-semibold text-amber-600")}>{limitLabel(r.used, r.max)}</span>
            </div>
            {r.max !== null && <Progress value={Math.min(100, (r.used / r.max) * 100)} className="h-2" />}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">Mensagens acima do limite ficam na fila e saem quando o mês vira.</p>
      </div>
    </SectionCard>
  );
}
