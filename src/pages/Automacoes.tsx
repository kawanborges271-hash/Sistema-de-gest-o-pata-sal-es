import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Ban, CheckCircle2, Clock, Megaphone, Pencil, Plus, RotateCcw, Send, Star, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState } from "@/components/common/EmptyState";
import { AutomationDialog } from "@/components/automacoes/AutomationDialog";
import { CampaignDialog } from "@/components/automacoes/CampaignDialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import {
  type QueueTab, useAddOptOut, useAutomations, useCampaignProgress, useCampaigns, useCancelQueued, useFeedback,
  useOptOuts, useQueue, useQueueCounters, useRemoveOptOut, useRetryQueued, useSaveAutomation, useWhatsappIntegration,
} from "@/hooks/useWhatsapp";
import { supabase } from "@/integrations/supabase/client";
import { AUTOMATION_META, AUTOMATION_ORDER, CAMPAIGN_AUDIENCES, MESSAGE_KIND_LABEL, QUEUE_STATUS_LABEL, QUEUE_STATUS_STYLE } from "@/lib/crm";
import { errorMessage } from "@/lib/errors";
import { formatPhone, normalizePhone, num } from "@/lib/format";
import { fmt, todayKey, zonedToUtc } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Automation } from "@/lib/types";

export default function Automacoes() {
  const { salon } = useAuth();
  const { can } = usePermissions();
  const tz = salon!.timezone;
  const isAdmin = can("automacoes.editar");
  const todayStart = useMemo(() => zonedToUtc(todayKey(tz), "00:00", tz).toISOString(), [tz]);
  const { data: counters } = useQueueCounters(todayStart);
  const { data: integration } = useWhatsappIntegration(isAdmin);
  const [tab, setTab] = useState("automacoes");

  return (
    <div>
      <PageHeader
        eyebrow="Relacionamento · Automações"
        title="O WhatsApp trabalhando sozinho."
        subtitle="Confirmação, lembrete, pós-atendimento, aniversário e reativação saem pela fila, no horário certo e sem passar do limite do dia."
      />

      {isAdmin && integration !== undefined && (!integration?.configured || !integration.active || integration.status !== "conectado") && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <span className="flex-1">
            {!integration?.configured
              ? "O WhatsApp ainda não está conectado. As mensagens ficam na fila até você conectar."
              : !integration.active
                ? "Os envios estão pausados. Nada sai da fila enquanto estiver assim."
                : "A Z-API não confirmou a conexão do número. Verifique em Configurações."}
          </span>
          <Button asChild size="sm" variant="outline"><Link to="/configuracoes#whatsapp">Abrir Configurações</Link></Button>
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Enviadas hoje" value={num(counters?.sentToday ?? 0)} formula={`Limite do dia: ${salon!.wa_daily_limit}`} icon={Send} highlight />
        <KpiCard label="Na fila" value={num(counters?.queued ?? 0)} formula="Aguardando horário, janela ou espaçamento" icon={Clock} />
        <KpiCard label="Falhas em 7 dias" value={num(counters?.failed7d ?? 0)} formula="Três tentativas sem sucesso" icon={AlertTriangle} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex h-auto flex-wrap justify-start">
          <TabsTrigger value="automacoes">Automações</TabsTrigger>
          <TabsTrigger value="fila">Fila</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="optout">Opt-out</TabsTrigger>
          <TabsTrigger value="notas">Notas</TabsTrigger>
        </TabsList>
        <TabsContent value="automacoes"><AutomationsTab isAdmin={isAdmin} /></TabsContent>
        <TabsContent value="fila"><QueueTabView /></TabsContent>
        <TabsContent value="campanhas"><CampaignsTab /></TabsContent>
        <TabsContent value="optout"><OptOutTab /></TabsContent>
        <TabsContent value="notas"><FeedbackTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------
function AutomationsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data: automations = [] } = useAutomations();
  const save = useSaveAutomation();
  const [editing, setEditing] = useState<Automation | null>(null);
  const byKind = Object.fromEntries(automations.map((a) => [a.kind, a]));

  const toggle = async (a: Automation, enabled: boolean) => {
    try {
      await save.mutateAsync({ id: a.id, enabled });
      toast.success(enabled ? "Automação ligada" : "Automação desligada");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const groups = [
    { key: "agenda", title: "Agenda", hint: "Do agendamento até o dia do horário." },
    { key: "relacionamento", title: "Relacionamento", hint: "Depois da visita: nota, retorno, aniversário e reativação." },
  ] as const;

  return (
    <div className="space-y-6">
      {isAdmin && <SendRulesCard />}
      {groups.map((g) => (
        <SectionCard key={g.key} title={g.title} hint={g.hint} bodyClassName="grid gap-3 p-5 md:grid-cols-2">
          {AUTOMATION_ORDER.filter((k) => AUTOMATION_META[k].group === g.key).map((k) => {
            const a = byKind[k] as Automation | undefined;
            const meta = AUTOMATION_META[k];
            if (!a) return null;
            return (
              <article key={k} className={cn("flex flex-col rounded-xl border border-border p-4", !a.enabled && "opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">{meta.title}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{meta.when}</p>
                  </div>
                  <Switch aria-label={`Ligar ${meta.title}`} checked={a.enabled} disabled={!isAdmin || save.isPending} onCheckedChange={(v) => toggle(a, v)} />
                </div>
                <p className="mt-3 line-clamp-3 whitespace-pre-wrap rounded-lg bg-muted/60 px-3 py-2 text-xs text-foreground/80">{a.template}</p>
                <p className="mt-2 text-xs"><span className="font-semibold">Depois:</span> <span className="text-muted-foreground">{meta.after}</span></p>
                {isAdmin && (
                  <Button variant="ghost" size="sm" className="mt-2 self-start" onClick={() => setEditing(a)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" /> Editar texto e regras
                  </Button>
                )}
              </article>
            );
          })}
        </SectionCard>
      ))}
      <AutomationDialog automation={editing} onOpenChange={(o) => !o && setEditing(null)} />
    </div>
  );
}

function SendRulesCard() {
  const { salon, refresh } = useAuth();
  const [form, setForm] = useState({
    start: salon!.wa_window_start.slice(0, 5),
    end: salon!.wa_window_end.slice(0, 5),
    limit: salon!.wa_daily_limit,
    spacing: salon!.wa_spacing_seconds,
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (form.start >= form.end) return toast.error("O fim da janela precisa ser depois do início");
    setSaving(true);
    const { error } = await supabase.from("salons").update({
      wa_window_start: form.start, wa_window_end: form.end, wa_daily_limit: form.limit, wa_spacing_seconds: form.spacing,
    }).eq("id", salon!.id);
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    toast.success("Regras de envio salvas");
  };

  return (
    <SectionCard title="Regras de envio" hint="Valem para tudo: automações, campanhas e mensagens da equipe. Cada mensagem tem até 3 tentativas; quem responder SAIR, PARAR ou STOP nunca mais recebe.">
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="wa-start" className="text-xs">Enviar a partir de</Label>
          <Input id="wa-start" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wa-end" className="text-xs">Até</Label>
          <Input id="wa-end" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wa-limit" className="text-xs">Limite por dia</Label>
          <Input id="wa-limit" type="number" min={1} max={1000} value={form.limit} onChange={(e) => setForm({ ...form, limit: Math.min(1000, Math.max(1, Number(e.target.value) || 1)) })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wa-spacing" className="text-xs">Intervalo entre mensagens (s)</Label>
          <Input id="wa-spacing" type="number" min={5} max={600} value={form.spacing} onChange={(e) => setForm({ ...form, spacing: Math.min(600, Math.max(5, Number(e.target.value) || 5)) })} />
        </div>
      </div>
      <Button className="mt-4" onClick={submit} disabled={saving}>Salvar regras</Button>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------
function QueueTabView() {
  const tz = useAuth().salon!.timezone;
  const [tab, setTab] = useState<QueueTab>("proximos");
  const { data: rows = [], isLoading } = useQueue(tab);
  const cancel = useCancelQueued();
  const retry = useRetryQueued();

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SectionCard
      actions={
        <Tabs value={tab} onValueChange={(v) => setTab(v as QueueTab)}>
          <TabsList>
            <TabsTrigger value="proximos">Próximos</TabsTrigger>
            <TabsTrigger value="enviadas">Enviadas</TabsTrigger>
            <TabsTrigger value="nao_enviadas">Não enviadas</TabsTrigger>
          </TabsList>
        </Tabs>
      }
      title="Fila de mensagens"
      hint="Últimas 100. Atualiza a cada 30 segundos."
    >
      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {!isLoading && rows.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nada por aqui.</p>}
      <ul className="divide-y divide-border">
        {rows.map((m) => (
          <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{m.client?.name ?? m.lead?.name ?? formatPhone(m.phone)}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{MESSAGE_KIND_LABEL[m.kind]}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px]", QUEUE_STATUS_STYLE[m.status])}>{QUEUE_STATUS_LABEL[m.status]}</span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-foreground/75">{m.body}</p>
              {m.last_error && m.status !== "enviada" && <p className="mt-1 text-xs text-destructive">{m.last_error}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span>
                {m.status === "enviada" && m.sent_at ? `enviada ${fmt(m.sent_at, "dd/MM HH:mm", tz)}`
                  : tab === "proximos" ? `a partir de ${fmt(m.scheduled_for, "dd/MM HH:mm", tz)}`
                    : fmt(m.created_at, "dd/MM HH:mm", tz)}
                {m.attempts > 0 && m.status !== "enviada" ? ` · ${m.attempts}ª tentativa` : ""}
              </span>
              {m.status === "pendente" && (
                <Button size="sm" variant="ghost" aria-label="Cancelar envio" onClick={() => act(() => cancel.mutateAsync(m.id), "Mensagem cancelada")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
              {(m.status === "falhou" || m.status === "expirada" || m.status === "cancelada") && (
                <Button size="sm" variant="outline" onClick={() => act(() => retry.mutateAsync(m.id), "Mensagem de volta na fila")}>
                  <RotateCcw className="mr-1 h-3.5 w-3.5" /> Tentar de novo
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------
function CampaignsTab() {
  const tz = useAuth().salon!.timezone;
  const { data: campaigns = [] } = useCampaigns();
  const { data: progress = {} } = useCampaignProgress(campaigns.map((c) => c.id));
  const [open, setOpen] = useState(false);
  const audienceLabel = (a: string) => CAMPAIGN_AUDIENCES.find((x) => x.value === a)?.label ?? "Lista manual";

  return (
    <SectionCard title="Campanhas" hint="Uma mensagem para um grupo de clientes, que sai aos poucos pela fila."
      actions={<Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nova campanha</Button>}>
      {campaigns.length === 0 ? (
        <EmptyState icon={Megaphone} title="Nenhuma campanha ainda" description="Escolha um público pronto, como quem não vem há 60 dias, e escreva a mensagem." />
      ) : (
        <ul className="divide-y divide-border">
          {campaigns.map((c) => {
            const p = progress[c.id] ?? { sent: 0, pending: 0, failed: 0 };
            const pct = c.recipients_count ? Math.round((p.sent / c.recipients_count) * 100) : 0;
            return (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{audienceLabel(c.audience)}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{fmt(c.scheduled_for, "dd/MM HH:mm", tz)}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-foreground/70">{c.body}</p>
                <div className="mt-2 flex items-center gap-3">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-success" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {p.sent} enviadas · {p.pending} na fila{p.failed ? ` · ${p.failed} não enviadas` : ""} · {c.recipients_count} no total
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CampaignDialog open={open} onOpenChange={setOpen} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------------
function OptOutTab() {
  const tz = useAuth().salon!.timezone;
  const { data: rows = [] } = useOptOuts();
  const add = useAddOptOut();
  const remove = useRemoveOptOut();
  const [phone, setPhone] = useState("");

  const submit = async () => {
    const p = normalizePhone(phone);
    if (!p) return toast.error("Telefone inválido");
    try {
      await add.mutateAsync(p);
      setPhone("");
      toast.success("Número não recebe mais mensagens automáticas");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <SectionCard title="Quem pediu para não receber" hint="Entra aqui sozinho quando a pessoa responde SAIR, PARAR ou STOP. Mensagens na fila para esses números são canceladas.">
      <div className="mb-4 flex flex-wrap gap-2">
        <Input placeholder="(11) 98888-7777" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full sm:w-60" aria-label="Telefone para opt-out" />
        <Button variant="outline" onClick={submit} disabled={add.isPending}><Ban className="mr-1 h-4 w-4" /> Adicionar</Button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">Ninguém na lista.</p> : (
        <ul className="divide-y divide-border">
          {rows.map((o) => (
            <li key={o.phone} className="flex items-center gap-3 py-2.5 text-sm">
              <span className="font-medium">{formatPhone(o.phone)}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                {o.reason === "palavra_chave" ? `respondeu "${(o.source_message ?? "SAIR").slice(0, 20)}"` : "adicionado pela equipe"}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">{fmt(o.created_at, "dd/MM/yyyy", tz)}</span>
              <Button size="sm" variant="ghost" aria-label="Remover do opt-out" onClick={async () => {
                if (!window.confirm("Voltar a enviar mensagens automáticas para este número? Só faça isso se a pessoa pediu.")) return;
                try {
                  await remove.mutateAsync(o.phone);
                  toast.success("Número removido da lista");
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------
function FeedbackTab() {
  const tz = useAuth().salon!.timezone;
  const { data: rows = [] } = useFeedback();
  const avg = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : null;
  const promoters = rows.filter((r) => r.score >= 9).length;
  const detractors = rows.filter((r) => r.score <= 6).length;
  const nps = rows.length ? Math.round(((promoters - detractors) / rows.length) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Nota média" value={avg === null ? "–" : avg.toFixed(1).replace(".", ",")} formula={`${rows.length} respostas ao pós-atendimento`} icon={Star} />
        <KpiCard label="NPS" value={nps === null ? "–" : String(nps)} formula="% de notas 9–10 menos % de notas 0–6" icon={CheckCircle2} />
        <KpiCard label="Notas baixas" value={num(detractors)} formula="Até 6: o dono recebe aviso no sino" icon={AlertTriangle} />
      </div>
      <SectionCard title="Respostas">
        {rows.length === 0 ? <p className="text-sm text-muted-foreground">As notas de 0 a 10 que as clientes respondem no pós-atendimento aparecem aqui.</p> : (
          <ul className="divide-y divide-border">
            {rows.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className={cn("grid h-8 w-8 place-items-center rounded-full text-sm font-semibold",
                  f.score >= 9 ? "bg-success/15 text-success" : f.score <= 6 ? "bg-destructive/10 text-destructive" : "bg-muted")}>
                  {f.score}
                </span>
                {f.client_id ? <Link to={`/clientes/${f.client_id}`} className="font-medium hover:underline">{f.client?.name ?? "Cliente"}</Link> : <span>Cliente</span>}
                <span className="ml-auto text-xs text-muted-foreground">{fmt(f.created_at, "dd/MM/yyyy HH:mm", tz)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
