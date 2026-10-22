import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/common/SectionCard";
import { usePlans, useSavePlan } from "@/hooks/usePlatform";
import { errorMessage } from "@/lib/errors";
import { num } from "@/lib/format";
import type { Plan, PlatformSalon } from "@/lib/types";

/** Limites por plano. Campo vazio = sem limite. Mudança vale na hora para todos os salões do plano. */
export function PlansTab({ salons }: { salons: PlatformSalon[] }) {
  const { data: plans = [] } = usePlans();
  return (
    <div className="grid gap-6 md:grid-cols-2">
      {plans.map((p) => <PlanCard key={p.id} plan={p} count={salons.filter((s) => s.plan_id === p.id).length} />)}
    </div>
  );
}

function PlanCard({ plan, count }: { plan: Plan; count: number }) {
  const save = useSavePlan();
  const from = () => ({ name: plan.name, pros: plan.max_professionals?.toString() ?? "", msgs: plan.max_messages_month?.toString() ?? "" });
  const [form, setForm] = useState(from);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(from()), [plan]);
  const parse = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));

  const submit = async () => {
    const pros = parse(form.pros);
    const msgs = parse(form.msgs);
    if (form.name.trim().length < 2) return toast.error("Dê um nome ao plano");
    if ([pros, msgs].some((v) => v !== null && !(v > 0))) return toast.error("Limites precisam ser maiores que zero (ou vazios)");
    try {
      await save.mutateAsync({ id: plan.id, name: form.name.trim(), maxProfessionals: pros, maxMessages: msgs });
      toast.success(`Plano ${form.name.trim()} salvo`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SectionCard title={plan.name} hint={`${num(count)} ${count === 1 ? "salão" : "salões"} neste plano · código ${plan.id}`}>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`pl-name-${plan.id}`} className="text-xs">Nome</Label>
          <Input id={`pl-name-${plan.id}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`pl-pros-${plan.id}`} className="text-xs">Profissionais ativos</Label>
            <Input id={`pl-pros-${plan.id}`} inputMode="numeric" placeholder="sem limite" value={form.pros} onChange={(e) => setForm({ ...form, pros: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`pl-msgs-${plan.id}`} className="text-xs">Mensagens por mês</Label>
            <Input id={`pl-msgs-${plan.id}`} inputMode="numeric" placeholder="sem limite" value={form.msgs} onChange={(e) => setForm({ ...form, msgs: e.target.value })} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Baixar o limite não desativa ninguém: só impede novos profissionais ativos. Mensagens acima do teto ficam na fila até o mês virar.
        </p>
        <Button onClick={submit} disabled={save.isPending}>Salvar plano</Button>
      </div>
    </SectionCard>
  );
}
