import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Brain, Megaphone, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState } from "@/components/common/EmptyState";
import { CampaignDialog } from "@/components/automacoes/CampaignDialog";
import { WEEKDAY_SHORT, pct, sampled } from "@/lib/insights";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/contexts/AuthContext";
import { useIntelActions, useIntelReport } from "@/hooks/useInsights";
import { useCampaignAudience } from "@/hooks/useWhatsapp";
import { CAMPAIGN_AUDIENCES } from "@/lib/crm";
import { EMPTY, formatPhone, money, num } from "@/lib/format";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { IntelAction, IntelReport } from "@/lib/types";

const LISTS = ["nao_voltaram", "reativar", "retoque", "pacotes_acabando"] as const;

type CampaignPreset = { audience: string; body?: string };

function dayBody(date: string) {
  return `Oi, {nome}! Abrimos horários no dia ${date.slice(8, 10)}/${date.slice(5, 7)} aqui no {salao}. Quer garantir o seu? {link_agendamento}`;
}

export default function Inteligencia() {
  const [days, setDays] = useState(90);
  const { data: actions = [], isLoading: loadingActions } = useIntelActions();
  const { data: report, isLoading } = useIntelReport(days);
  const [campaign, setCampaign] = useState<CampaignPreset | null>(null);

  const runAction = (a: IntelAction) => {
    if (a.action.type === "campaign") setCampaign({ audience: a.action.audience, body: a.action.date ? dayBody(a.action.date) : undefined });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Vendas · Inteligência"
        title="Onde está o dinheiro parado"
        subtitle="O plano de ação ordena as oportunidades pelo valor estimado. Cada lista vira campanha de WhatsApp em dois cliques."
      />

      <SectionCard title="Plano de ação" hint="Valor estimado = clientes × ticket médio dos últimos 60 dias × chance de voltar." className="mb-6">
        {loadingActions && <div className="h-32 animate-pulse rounded-xl bg-muted" />}
        {!loadingActions && actions.length === 0 && (
          <EmptyState icon={Sparkles} title="Nada urgente agora" description="Sem leads parados, listas vazias e agenda equilibrada. Volte amanhã." />
        )}
        <ol className="space-y-3">
          {actions.map((a) => (
            <li key={a.key} className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-center">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary font-display text-base text-primary-foreground">{a.rank}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{a.title}</div>
                <div className="text-sm text-muted-foreground">{a.detail}</div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {a.impact > 0 && <span className="text-xs text-muted-foreground">até <b className="text-foreground">{money(a.impact)}</b></span>}
                {a.action.type === "link" ? (
                  <Button asChild variant="outline" size="sm"><Link to={a.action.to}>{a.action.label}<ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button>
                ) : (
                  <Button size="sm" onClick={() => runAction(a)}><Megaphone className="mr-1.5 h-3.5 w-3.5" />{a.action.label}</Button>
                )}
              </div>
            </li>
          ))}
        </ol>
      </SectionCard>

      <SectionCard title="Listas para campanha" className="mb-6">
        <Tabs defaultValue={LISTS[0]}>
          <TabsList className="flex-wrap">
            {LISTS.map((l) => <TabsTrigger key={l} value={l}>{CAMPAIGN_AUDIENCES.find((x) => x.value === l)?.label}</TabsTrigger>)}
          </TabsList>
          {LISTS.map((l) => (
            <TabsContent key={l} value={l}>
              <AudienceList audience={l} onCampaign={() => setCampaign({ audience: l })} />
            </TabsContent>
          ))}
        </Tabs>
      </SectionCard>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-medium">Análise do período</h2>
        <ToggleGroup type="single" value={String(days)} onValueChange={(v) => v && setDays(Number(v))} className="rounded-xl border border-border bg-card p-1">
          {[30, 90, 180, 365].map((d) => <ToggleGroupItem key={d} value={String(d)} className="h-8 rounded-lg px-3 text-xs">{d} dias</ToggleGroupItem>)}
        </ToggleGroup>
      </div>

      {isLoading || !report ? <div className="h-64 animate-pulse rounded-2xl bg-muted" /> : <Analysis report={report} />}

      <CampaignDialog open={campaign !== null} onOpenChange={(o) => !o && setCampaign(null)}
        defaultAudience={campaign?.audience} defaultBody={campaign?.body} />
    </div>
  );
}

function AudienceList({ audience, onCampaign }: { audience: string; onCampaign: () => void }) {
  const { salon } = useAuth();
  const { data: rows = [], isLoading } = useCampaignAudience(audience);
  const hint = CAMPAIGN_AUDIENCES.find((x) => x.value === audience)?.hint;
  return (
    <div className="pt-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{hint} · <b className="text-foreground">{num(rows.length)}</b> com WhatsApp</p>
        <Button size="sm" onClick={onCampaign} disabled={!rows.length}><Megaphone className="mr-1.5 h-3.5 w-3.5" />Criar campanha</Button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-border">
        {isLoading && <p className="p-3 text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && rows.length === 0 && <p className="p-3 text-sm text-muted-foreground">Ninguém nesta lista agora.</p>}
        {rows.slice(0, 100).map((r) => (
          <div key={r.client_id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
            <Link to={`/clientes/${r.client_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{r.name}</Link>
            <span className="hidden text-xs text-muted-foreground sm:inline">{formatPhone(r.phone)}</span>
            <span className="w-28 text-right text-xs text-muted-foreground">{r.last_visit_at ? `última ${fmt(r.last_visit_at, "dd/MM/yy", salon!.timezone)}` : EMPTY}</span>
            <span className="w-24 text-right text-xs tabular-nums">{money(r.total_spent ?? 0)}</span>
          </div>
        ))}
        {rows.length > 100 && <p className="p-3 text-xs text-muted-foreground">Mostrando 100 de {num(rows.length)}. A campanha inclui todos.</p>}
      </div>
    </div>
  );
}

function Analysis({ report }: { report: IntelReport }) {
  const maxNs = Math.max(...report.no_shows.map((d) => d.rate ?? 0), 0.01);
  const hours = [...new Set(report.heatmap.map((h) => h.hour))].sort((a, b) => a - b);
  const cell = (wd: number, hr: number) => report.heatmap.find((h) => h.weekday === wd && h.hour === hr);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Serviços que mais faturam" hint="Itens de comandas pagas no período" bodyClassName="p-0">
          {report.services.length === 0 ? <p className="p-5 text-sm text-muted-foreground">Sem vendas no período.</p> : (
            <table className="w-full text-sm">
              <thead className="label-caps text-left"><tr className="border-b border-border">
                <th className="py-2.5 pl-5 font-medium">Serviço</th><th className="text-right font-medium">Vendas</th>
                <th className="text-right font-medium">Faturamento</th><th className="pr-5 text-right font-medium">Ticket médio</th>
              </tr></thead>
              <tbody>
                {report.services.map((s) => (
                  <tr key={s.service_id} className="border-b border-border last:border-0">
                    <td className="py-2 pl-5">{s.name}</td>
                    <td className="text-right tabular-nums">{num(s.sales)}</td>
                    <td className="text-right tabular-nums">{money(s.revenue)}</td>
                    <td className="pr-5 text-right tabular-nums">{s.sales < 3 ? "poucos" : money(s.avg_ticket)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>

        <SectionCard title="Faltas por dia da semana" hint="Faltaram ÷ (compareceram + faltaram)">
          <div className="space-y-2.5">
            {report.no_shows.map((d) => (
              <div key={d.weekday} className="flex items-center gap-3 text-sm">
                <span className="w-9 text-xs font-semibold">{WEEKDAY_SHORT[d.weekday]}</span>
                <div className="h-5 flex-1 rounded-md bg-muted">
                  {d.total >= 3 && <div className="h-5 rounded-md bg-rose-500/70" style={{ width: `${Math.max(2, ((d.rate ?? 0) / maxNs) * 100)}%` }} />}
                </div>
                <span className="w-28 text-right text-xs tabular-nums text-muted-foreground">
                  {sampled(d.total, `${pct(d.rate)} · ${d.no_shows}/${d.total}`)}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Ocupação por dia e horário" hint={`Horas agendadas ÷ horas disponíveis, últimas ${Math.min(8, Math.ceil(report.days / 7))} semanas. Quanto mais escuro, mais cheio.`} bodyClassName="overflow-x-auto">
        {hours.length === 0 ? <p className="text-sm text-muted-foreground">Cadastre o horário de trabalho dos profissionais para ver o mapa.</p> : (
          <table className="mx-auto border-separate border-spacing-1 text-xs">
            <thead><tr><th />{hours.map((h) => <th key={h} className="w-11 font-medium text-muted-foreground">{String(h).padStart(2, "0")}h</th>)}</tr></thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((wd) => (
                <tr key={wd}>
                  <th className="pr-2 text-left font-semibold">{WEEKDAY_SHORT[wd]}</th>
                  {hours.map((hr) => {
                    const c = cell(wd, hr);
                    const rate = c?.rate ?? null;
                    return (
                      <td key={hr} title={c ? `${WEEKDAY_SHORT[wd]} ${hr}h · ${pct(rate)}` : "Fechado"}
                        className={cn("h-9 w-11 rounded-md text-center tabular-nums", !c && "bg-muted/40")}
                        style={c ? { background: `hsl(var(--copper) / ${0.08 + (rate ?? 0) * 0.85})`, color: (rate ?? 0) > 0.55 ? "white" : undefined } : undefined}>
                        {c ? (rate === null ? EMPTY : Math.round(rate * 100)) : ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard title="Desempenho por profissional" hint="“poucos” quando há menos de 3 casos para calcular a taxa." bodyClassName="overflow-x-auto p-0">
        {report.professionals.length === 0 ? <div className="p-5"><EmptyState icon={Brain} title="Sem profissionais ativos" description="Cadastre a equipe para comparar o desempenho." /></div> : (
          <table className="w-full min-w-[820px] text-sm">
            <thead className="label-caps text-left"><tr className="border-b border-border">
              {["Profissional", "Agendados", "Comparecimento", "Faturamento", "Ticket médio", "Retorno das clientes", "Venda de produtos"].map((h, i) => (
                <th key={h} className={cn("py-2.5 font-medium", i ? "px-3 text-right" : "pl-5")}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {report.professionals.map((p) => (
                <tr key={p.professional_id} className="border-b border-border last:border-0">
                  <td className="py-2.5 pl-5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />{p.name}</td>
                  <td className="px-3 text-right tabular-nums">{num(p.appointments)}</td>
                  <td className="px-3 text-right tabular-nums">{sampled(p.attended + p.no_shows, pct(p.attendance_rate))}</td>
                  <td className="px-3 text-right tabular-nums">{money(p.revenue)}</td>
                  <td className="px-3 text-right tabular-nums">{sampled(p.orders, money(p.avg_ticket))}</td>
                  <td className="px-3 text-right tabular-nums">{sampled(p.clients, `${pct(p.return_rate)} · ${p.returned}/${p.clients}`)}</td>
                  <td className="px-3 pr-5 text-right tabular-nums">{money(p.product_revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}
