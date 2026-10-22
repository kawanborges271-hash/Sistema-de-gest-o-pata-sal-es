import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Megaphone, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { MetricCard } from "@/components/insights/shared";
import { pct } from "@/lib/insights";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useDeleteMarketingMonth, useMarketingReport, useSaveMarketingEntries, type MarketingEntryInput } from "@/hooks/useInsights";
import { EMPTY, money, num } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { MarketingChannel, MarketingRow } from "@/lib/types";

const CHANNELS: { value: MarketingChannel; label: string }[] = [
  { value: "meta_ads", label: "Meta Ads" },
  { value: "google", label: "Google" },
  { value: "instagram", label: "Instagram orgânico" },
  { value: "indicacao", label: "Indicação" },
];

type Totals = { hasEntry: boolean; investment: number; leads: number; appointments: number; sales: number; revenue: number };

function totals(rows: MarketingRow[]): Totals {
  return rows.reduce<Totals>((t, r) => ({
    hasEntry: t.hasEntry || r.has_entry,
    investment: t.investment + Number(r.investment ?? 0),
    leads: t.leads + (r.leads ?? 0),
    appointments: t.appointments + (r.appointments ?? 0),
    sales: t.sales + (r.sales ?? 0),
    revenue: t.revenue + Number(r.revenue ?? 0),
  }), { hasEntry: false, investment: 0, leads: 0, appointments: 0, sales: 0, revenue: 0 });
}

/** Indicadores que dependem do investimento só existem com lançamento; sem base, "—". */
function ratios(t: Totals) {
  const div = (a: number, b: number) => (b > 0 ? a / b : null);
  return {
    roi: t.hasEntry && t.investment > 0 ? (t.revenue - t.investment) / t.investment : null,
    cpl: t.hasEntry ? div(t.investment, t.leads) : null,
    cpa: t.hasEntry ? div(t.investment, t.appointments) : null,
    ticket: div(t.revenue, t.sales),
    conversion: div(t.sales, t.leads),
  };
}

const monthLabel = (m: string, long = false) => fmt(`${m}T12:00:00Z`, long ? "MMMM 'de' yyyy" : "MMM/yy", "UTC");
const roiLabel = (v: number | null) => (v === null ? EMPTY : `${v >= 0 ? "+" : ""}${pct(v)}`);

type Draft = Record<MarketingChannel, { investment: string; leads: string; appointments: string; sales: string; revenue: string; notes: string }>;

export default function Marketing() {
  const { data: rows = [], isLoading } = useMarketingReport(12);
  const save = useSaveMarketingEntries();
  const remove = useDeleteMarketingMonth();
  const months = useMemo(() => [...new Set(rows.map((r) => r.month))], [rows]);
  const [month, setMonth] = useState<string>("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const current = month || months[months.length - 1] || "";
  const monthRows = useMemo(() => rows.filter((r) => r.month === current), [rows, current]);
  const monthTotals = totals(monthRows);
  const monthRatios = ratios(monthTotals);

  useEffect(() => {
    if (!monthRows.length) return;
    const field = (v: number | null, auto: number | null) => (v !== null && v !== auto ? String(v) : "");
    setDraft(Object.fromEntries(CHANNELS.map(({ value }) => {
      const r = monthRows.find((x) => x.channel === value)!;
      return [value, {
        investment: r.has_entry ? String(r.investment) : "",
        leads: r.has_entry ? field(r.leads, r.auto_leads) : "",
        appointments: r.has_entry ? field(r.appointments, r.auto_appointments) : "",
        sales: r.has_entry ? field(r.sales, r.auto_sales) : "",
        revenue: r.has_entry ? field(r.revenue === null ? null : Number(r.revenue), r.auto_revenue === null ? null : Number(r.auto_revenue)) : "",
        notes: r.notes ?? "",
      }];
    })) as Draft);
  }, [monthRows]);

  const evolution = useMemo(() => months.map((m) => {
    const t = totals(rows.filter((r) => r.month === m));
    return { month: m, label: monthLabel(m), ...t, ...ratios(t), investmentChart: t.hasEntry ? t.investment : null };
  }), [months, rows]);

  const submit = async () => {
    if (!draft) return;
    const n = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));
    const out: MarketingEntryInput[] = [];
    for (const { value } of CHANNELS) {
      const d = draft[value];
      const filled = [d.investment, d.leads, d.appointments, d.sales, d.revenue, d.notes].some((x) => x.trim() !== "");
      const existed = monthRows.find((r) => r.channel === value)?.has_entry;
      if (!filled && !existed) continue;
      const values = [n(d.investment), n(d.leads), n(d.appointments), n(d.sales), n(d.revenue)];
      if (values.some((v) => v !== null && (Number.isNaN(v) || v < 0))) return toast.error("Use só números positivos");
      out.push({ month: current, channel: value, investment: values[0] ?? 0, leads: values[1], appointments: values[2], sales: values[3], revenue: values[4], notes: d.notes.trim() || null });
    }
    if (!out.length) return toast.error("Preencha o investimento de pelo menos um canal");
    try {
      await save.mutateAsync(out);
      toast.success(`Lançamento de ${monthLabel(current, true)} salvo`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const set = (ch: MarketingChannel, k: keyof Draft[MarketingChannel], v: string) => draft && setDraft({ ...draft, [ch]: { ...draft[ch], [k]: v } });

  return (
    <div>
      <PageHeader
        eyebrow="Vendas · Marketing"
        title="Quanto cada canal traz de volta"
        subtitle="Lance o investimento do mês por canal. Leads, agendamentos, vendas e receita vêm da origem de cada cliente, e você pode corrigir à mão."
        actions={months.length > 0 && (
          <Select value={current} onValueChange={setMonth}>
            <SelectTrigger className="w-48" aria-label="Mês"><SelectValue /></SelectTrigger>
            <SelectContent>{[...months].reverse().map((m) => <SelectItem key={m} value={m}>{monthLabel(m, true)}</SelectItem>)}</SelectContent>
          </Select>
        )}
      />

      {isLoading ? <div className="h-64 animate-pulse rounded-2xl bg-muted" /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard highlight label="Receita dos canais" icon={Megaphone} value={money(monthTotals.revenue)}
              formula="Comandas pagas por clientes de cada origem no mês" />
            <MetricCard label="Investimento" value={monthTotals.hasEntry ? money(monthTotals.investment) : EMPTY}
              formula={monthTotals.hasEntry ? "Soma lançada nos 4 canais" : "Mês sem lançamento"} />
            <MetricCard label="ROI" value={roiLabel(monthRatios.roi)} formula="(Receita − investimento) ÷ investimento" />
            <MetricCard label="Lead → venda" value={pct(monthRatios.conversion)} formula={`Vendas ÷ leads · ${num(monthTotals.sales)} ÷ ${num(monthTotals.leads)}`} />
            <MetricCard label="Custo por lead (CPL)" value={money(monthRatios.cpl)} formula="Investimento ÷ leads" />
            <MetricCard label="Custo por agendamento" value={money(monthRatios.cpa)} formula="Investimento ÷ agendamentos" />
            <MetricCard label="Ticket médio" value={money(monthRatios.ticket)} formula="Receita ÷ vendas" />
            <MetricCard label="Agendamentos" value={num(monthTotals.appointments)} formula="Criados no mês por clientes dos canais" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <SectionCard className="xl:col-span-2" title={`Por canal · ${monthLabel(current, true)}`} hint="“—” quando o mês não tem lançamento ou a base é zero." bodyClassName="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="label-caps text-left">
                  <tr className="border-b border-border">
                    {["Canal", "Investimento", "Leads", "Agend.", "Vendas", "Receita", "ROI", "CPL", "Custo/agend.", "Ticket", "Lead→venda"].map((h, i) => (
                      <th key={h} className={cn("px-3 py-2.5 font-medium", i === 0 ? "pl-5" : "text-right")}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...CHANNELS.map((c) => ({ label: c.label, rows: monthRows.filter((r) => r.channel === c.value) })), { label: "Total", rows: monthRows }].map(({ label, rows: rs }) => {
                    const t = totals(rs);
                    const r = ratios(t);
                    return (
                      <tr key={label} className={cn("border-b border-border last:border-0", label === "Total" && "bg-muted/40 font-semibold")}>
                        <td className="py-2.5 pl-5 pr-3">{label}</td>
                        <td className="px-3 text-right tabular-nums">{t.hasEntry ? money(t.investment) : EMPTY}</td>
                        <td className="px-3 text-right tabular-nums">{num(t.leads)}</td>
                        <td className="px-3 text-right tabular-nums">{num(t.appointments)}</td>
                        <td className="px-3 text-right tabular-nums">{num(t.sales)}</td>
                        <td className="px-3 text-right tabular-nums">{money(t.revenue)}</td>
                        <td className={cn("px-3 text-right tabular-nums", r.roi !== null && (r.roi >= 0 ? "text-emerald-600" : "text-rose-600"))}>{roiLabel(r.roi)}</td>
                        <td className="px-3 text-right tabular-nums">{money(r.cpl)}</td>
                        <td className="px-3 text-right tabular-nums">{money(r.cpa)}</td>
                        <td className="px-3 text-right tabular-nums">{money(r.ticket)}</td>
                        <td className="px-3 pr-5 text-right tabular-nums">{pct(r.conversion)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </SectionCard>

            <SectionCard title="Funil do mês" hint="Leads → agendamentos → vendas">
              {[
                { label: "Leads", value: monthTotals.leads },
                { label: "Agendamentos", value: monthTotals.appointments },
                { label: "Vendas", value: monthTotals.sales },
              ].map((s, i, all) => {
                const top = Math.max(...all.map((x) => x.value), 1);
                const prev = i > 0 ? all[i - 1].value : null;
                return (
                  <div key={s.label} className="mb-3">
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="font-medium">{s.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {num(s.value)}{prev !== null && prev > 0 && s.value <= prev && ` · ${pct(s.value / prev)} da etapa anterior`}
                      </span>
                    </div>
                    <div className="h-7 rounded-lg bg-muted">
                      <div className="h-7 rounded-lg bg-primary" style={{ width: `${Math.min(100, Math.max(2, (s.value / top) * 100))}%`, opacity: 1 - i * 0.22 }} />
                    </div>
                  </div>
                );
              })}
              <p className="mt-4 text-xs text-muted-foreground">Receita: <b className="text-foreground">{money(monthTotals.revenue)}</b> · Investimento: <b className="text-foreground">{monthTotals.hasEntry ? money(monthTotals.investment) : EMPTY}</b></p>
            </SectionCard>
          </div>

          <SectionCard className="mt-6" title={`Lançamento de ${monthLabel(current, true)}`}
            hint="Investimento é obrigatório para o canal entrar no ROI. Deixe os outros campos vazios para usar o número calculado (aparece em cinza)."
            actions={monthTotals.hasEntry && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="mr-1.5 h-4 w-4" />Apagar lançamento
              </Button>
            )} bodyClassName="overflow-x-auto">
            {draft && (
              <div className="min-w-[760px] space-y-2">
                <div className="label-caps grid grid-cols-[10rem_repeat(5,1fr)_1.6fr] gap-2">
                  <span>Canal</span><span>Investimento (R$)</span><span>Leads</span><span>Agendamentos</span><span>Vendas</span><span>Receita (R$)</span><span>Observação</span>
                </div>
                {CHANNELS.map(({ value, label }) => {
                  const r = monthRows.find((x) => x.channel === value);
                  const d = draft[value];
                  return (
                    <div key={value} className="grid grid-cols-[10rem_repeat(5,1fr)_1.6fr] items-center gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      <Input inputMode="decimal" aria-label={`Investimento ${label}`} value={d.investment} onChange={(e) => set(value, "investment", e.target.value)} placeholder="0,00" />
                      <Input inputMode="numeric" aria-label={`Leads ${label}`} value={d.leads} onChange={(e) => set(value, "leads", e.target.value)} placeholder={String(r?.auto_leads ?? 0)} />
                      <Input inputMode="numeric" aria-label={`Agendamentos ${label}`} value={d.appointments} onChange={(e) => set(value, "appointments", e.target.value)} placeholder={String(r?.auto_appointments ?? 0)} />
                      <Input inputMode="numeric" aria-label={`Vendas ${label}`} value={d.sales} onChange={(e) => set(value, "sales", e.target.value)} placeholder={String(r?.auto_sales ?? 0)} />
                      <Input inputMode="decimal" aria-label={`Receita ${label}`} value={d.revenue} onChange={(e) => set(value, "revenue", e.target.value)} placeholder={String(Number(r?.auto_revenue ?? 0).toFixed(2))} />
                      <Input aria-label={`Observação ${label}`} value={d.notes} onChange={(e) => set(value, "notes", e.target.value)} />
                    </div>
                  );
                })}
                <div className="flex justify-end pt-2">
                  <Button onClick={submit} disabled={save.isPending}>Salvar lançamento</Button>
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard className="mt-6" title="Evolução de 12 meses" hint="Investimento e receita por mês. Meses sem lançamento ficam com “—”." bodyClassName="space-y-5">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={evolution} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={56} />
                  <Tooltip formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                  <Area dataKey="revenue" name="Receita" fill="hsl(var(--primary) / 0.12)" stroke="hsl(var(--primary))" />
                  <Line dataKey="investmentChart" name="Investimento" stroke="hsl(var(--copper))" strokeWidth={2} dot connectNulls={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="label-caps text-left">
                  <tr className="border-b border-border">
                    {["Mês", "Investimento", "Leads", "Vendas", "Receita", "ROI", "CPL", "Lead→venda"].map((h, i) => <th key={h} className={cn("py-2 font-medium", i ? "text-right" : "")}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {[...evolution].reverse().map((e) => (
                    <tr key={e.month} className={cn("border-b border-border last:border-0", e.month === current && "font-semibold")}>
                      <td className="py-2 capitalize"><button type="button" className="hover:underline" onClick={() => setMonth(e.month)}>{monthLabel(e.month, true)}</button></td>
                      <td className="text-right tabular-nums">{e.hasEntry ? money(e.investment) : EMPTY}</td>
                      <td className="text-right tabular-nums">{num(e.leads)}</td>
                      <td className="text-right tabular-nums">{num(e.sales)}</td>
                      <td className="text-right tabular-nums">{money(e.revenue)}</td>
                      <td className="text-right tabular-nums">{roiLabel(e.roi)}</td>
                      <td className="text-right tabular-nums">{money(e.cpl)}</td>
                      <td className="text-right tabular-nums">{pct(e.conversion)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apagar o lançamento de {current && monthLabel(current, true)}?</AlertDialogTitle>
            <AlertDialogDescription>O mês volta a aparecer sem lançamento (“—”). A mudança fica registrada no histórico.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              try { await remove.mutateAsync(current); toast.success("Lançamento apagado"); } catch (err) { toast.error(errorMessage(err)); }
            }}>Apagar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
