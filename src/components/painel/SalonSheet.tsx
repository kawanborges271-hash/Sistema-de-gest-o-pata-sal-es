import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { MoveTarget } from "@/components/painel/MoveUserDialog";
import { usePlans, usePlatformSalonMembers, useSetPlan, useSetSuspended } from "@/hooks/usePlatform";
import { ROLE_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { num, timeAgo } from "@/lib/format";
import { limitLabel, WHATSAPP_LABEL } from "@/lib/platform";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { PlatformSalon } from "@/lib/types";

/** Detalhe do salão no painel: uso, plano, equipe e suspensão. Sem nenhum valor financeiro. */
export function SalonSheet({ salon: s, onClose, onMove }: { salon: PlatformSalon | null; onClose: () => void; onMove: (t: MoveTarget) => void }) {
  const { data: plans = [] } = usePlans();
  const { data: members = [] } = usePlatformSalonMembers(s?.id ?? null);
  const setPlan = useSetPlan();
  const setSuspended = useSetSuspended();
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [s?.id]);

  const changePlan = (planId: string) =>
    s && setPlan.mutate({ salonId: s.id, planId }, {
      onSuccess: () => toast.success("Plano alterado"),
      onError: (err) => toast.error(errorMessage(err)),
    });

  const toggle = (suspended: boolean) =>
    s && setSuspended.mutate({ salonId: s.id, suspended, reason: reason.trim() }, {
      onSuccess: () => { toast.success(suspended ? "Salão suspenso: a equipe perdeu o acesso" : "Salão reativado"); setReason(""); },
      onError: (err) => toast.error(errorMessage(err)),
    });

  const stats: [string, string][] = s ? [
    ["Equipe ativa", num(s.team)],
    ["Profissionais", limitLabel(s.professionals, s.max_professionals)],
    ["Clientes", num(s.clients)],
    ["Agendamentos (30 dias)", num(s.appointments_30d)],
    ["Leads (30 dias)", num(s.leads_30d)],
    ["Mensagens no mês", limitLabel(s.messages_month, s.max_messages_month)],
    ["WhatsApp", s.whatsapp_status ? WHATSAPP_LABEL[s.whatsapp_status] : "Não configurado"],
    ["Agendamento online", s.online_booking ? "Ligado" : "Desligado"],
    ["Última atividade", timeAgo(s.last_activity_at)],
    ["Último login da equipe", timeAgo(s.last_login_at)],
  ] : [];

  return (
    <Sheet open={s !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {s && (
          <>
            <SheetHeader>
              <SheetTitle className="font-display text-2xl font-light">{s.name}</SheetTitle>
              <p className="text-sm text-muted-foreground">/agendar/{s.slug} · criado em {fmt(s.created_at, "dd/MM/yyyy")}</p>
            </SheetHeader>

            {s.suspended_at && (
              <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <b className="text-destructive">Suspenso</b> desde {fmt(s.suspended_at, "dd/MM/yyyy HH:mm")}
                {s.suspended_reason && <div className="text-muted-foreground">Motivo: {s.suspended_reason}</div>}
              </div>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {stats.map(([k, v]) => (
                <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
              ))}
            </dl>

            <div className="mt-6 space-y-1.5">
              <Label className="text-xs">Plano</Label>
              <Select value={s.plan_id} onValueChange={changePlan} disabled={setPlan.isPending}>
                <SelectTrigger aria-label="Plano do salão"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.max_professionals ?? "∞"} profissionais · {p.max_messages_month ? num(p.max_messages_month) : "∞"} mensagens/mês
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-6">
              <div className="mb-2 label-caps">Equipe</div>
              <ul className="divide-y divide-border rounded-xl border border-border">
                {members.length === 0 && <li className="p-3 text-sm text-muted-foreground">Ninguém ainda (convite pendente).</li>}
                {members.map((m) => (
                  <li key={m.member_id} className={cn("flex items-center gap-3 p-3 text-sm", !m.active && "text-muted-foreground")}>
                    <div className="min-w-0 flex-1">
                      <div className={cn("truncate font-medium", !m.active && "line-through")}>{m.full_name || m.email}</div>
                      <div className="truncate text-xs text-muted-foreground">{m.email} · {ROLE_LABEL[m.role]} · último acesso {timeAgo(m.last_sign_in_at)}</div>
                    </div>
                    {m.active && (
                      <Button size="sm" variant="outline"
                        onClick={() => onMove({ userId: m.user_id, name: m.full_name || m.email || "Usuário", fromSalonId: s.id, fromSalonName: s.name, role: m.role })}>
                        Mover
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6 rounded-xl border border-border p-4">
              {s.suspended_at ? (
                <>
                  <p className="text-sm">Reativar devolve o acesso da equipe e retoma os envios de WhatsApp.</p>
                  <Button className="mt-3" onClick={() => toggle(false)} disabled={setSuspended.isPending}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />Reativar salão
                  </Button>
                </>
              ) : (
                <>
                  <Label htmlFor="susp-reason" className="text-xs">Suspender acesso</Label>
                  <Textarea id="susp-reason" rows={2} className="mt-1.5" placeholder="Motivo (ex.: mensalidade em atraso)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <p className="mt-1.5 text-xs text-muted-foreground">Ninguém do salão entra e nenhuma mensagem sai enquanto estiver suspenso. Os dados ficam intactos.</p>
                  <Button variant="destructive" className="mt-3" onClick={() => toggle(true)} disabled={setSuspended.isPending || reason.trim().length < 3}>
                    <Ban className="mr-1.5 h-4 w-4" />Suspender
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
