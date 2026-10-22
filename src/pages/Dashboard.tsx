import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BadgeDollarSign, CalendarCheck, Cake, CalendarClock, Gauge, Package, Receipt, Repeat, UserPlus, Users, Wallet, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { Delta, MetricCard } from "@/components/insights/shared";
import { pct } from "@/lib/insights";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useDashboard } from "@/hooks/useInsights";
import { formatPhone, money, num } from "@/lib/format";
import { addDaysKey, fmt, todayKey } from "@/lib/tz";
import { STATUS_LABEL } from "@/lib/agenda";

type Preset = "7d" | "30d" | "mes" | "90d" | "custom";
const PRESETS: { value: Preset; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "mes", label: "Este mês" },
  { value: "90d", label: "90 dias" },
  { value: "custom", label: "Escolher" },
];

const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const hours = (h: number) => `${num(Math.round(h))} h`;

export default function Dashboard() {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const today = todayKey(tz);
  const [preset, setPreset] = useState<Preset>("30d");
  const [custom, setCustom] = useState({ from: addDaysKey(today, -29), to: today });
  const [from, to] =
    preset === "7d" ? [addDaysKey(today, -6), today]
    : preset === "30d" ? [addDaysKey(today, -29), today]
    : preset === "90d" ? [addDaysKey(today, -89), today]
    : preset === "mes" ? [`${today.slice(0, 8)}01`, today]
    : [custom.from, custom.to];
  const { data, isLoading, error } = useDashboard(from, to);
  const c = data?.current;
  const p = data?.previous;

  return (
    <div>
      <PageHeader
        eyebrow="Vendas · Dashboard"
        title="Como o salão está indo"
        subtitle="Cada número tem a fórmula escrita embaixo e a comparação com o período anterior do mesmo tamanho."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" value={preset} onValueChange={(v) => v && setPreset(v as Preset)} className="rounded-xl border border-border bg-card p-1">
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
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">Não foi possível carregar o dashboard.</p>}
      {isLoading || !c || !p ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{Array.from({ length: 10 }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {dm(c.from)} a {dm(c.to)} · comparando com {dm(p.from)} a {dm(p.to)}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard highlight label="Faturamento" icon={BadgeDollarSign} value={money(c.revenue)}
              compare={<Delta current={c.revenue} previous={p.revenue} />} previousLabel={money(p.revenue)}
              formula="Soma das comandas fechadas no período" />
            <MetricCard label="Comandas fechadas" icon={Receipt} value={num(c.orders)}
              compare={<Delta current={c.orders} previous={p.orders} />} previousLabel={num(p.orders)}
              formula="Comandas com status fechada" />
            <MetricCard label="Ticket médio" icon={Wallet} value={money(c.avg_ticket)}
              compare={<Delta current={c.avg_ticket} previous={p.avg_ticket} />} previousLabel={money(p.avg_ticket)}
              formula="Faturamento ÷ comandas fechadas" />
            <MetricCard label="Agendamentos" icon={CalendarCheck} value={num(c.appointments)}
              compare={<Delta current={c.appointments} previous={p.appointments} />} previousLabel={num(p.appointments)}
              formula="Horários do período, sem cancelados e remarcados" />
            <MetricCard label="Comparecimento" icon={UserCheck} value={pct(c.attendance_rate)}
              compare={<Delta current={c.attendance_rate} previous={p.attendance_rate} points />} previousLabel={pct(p.attendance_rate)}
              formula={`Compareceram ÷ (compareceram + faltaram) · ${num(c.attended)} ÷ ${num(c.attended + c.no_shows)}`} />
            <MetricCard label="Ocupação da agenda" icon={Gauge} value={pct(c.occupancy)}
              compare={<Delta current={c.occupancy} previous={p.occupancy} points />} previousLabel={pct(p.occupancy)}
              formula={`Horas agendadas ÷ horas disponíveis · ${hours(c.booked_hours)} ÷ ${hours(c.available_hours)}`} />
            <MetricCard label="Clientes novos" icon={UserPlus} value={num(c.new_clients)}
              compare={<Delta current={c.new_clients} previous={p.new_clients} />} previousLabel={num(p.new_clients)}
              formula="Primeira visita concluída no período" />
            <MetricCard label="Clientes que voltaram" icon={Repeat} value={num(c.returning_clients)}
              compare={<Delta current={c.returning_clients} previous={p.returning_clients} />} previousLabel={num(p.returning_clients)}
              formula="Vieram no período e já tinham vindo antes" />
            <MetricCard label="Venda de produtos" icon={Package} value={pct(c.product_share)}
              compare={<Delta current={c.product_share} previous={p.product_share} points />} previousLabel={pct(p.product_share)}
              formula={`Produtos ÷ faturamento · ${money(c.product_revenue)}`} />
            <MetricCard label="Comissões do período" icon={Users} value={money(c.commissions)}
              compare={<Delta current={c.commissions} previous={p.commissions} inverse />} previousLabel={money(p.commissions)}
              formula="Comissões geradas, sem as estornadas" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <SectionCard className="xl:col-span-2" title={`Faturamento por ${data.granularity === "semana" ? "semana" : "dia"}`}
              hint="Barras escuras: período atual. Claras: o mesmo dia/semana do período anterior.">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.series.map((s) => ({ ...s, label: dm(s.bucket) }))} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={12} />
                    <YAxis tickLine={false} axisLine={false} fontSize={11} width={56}
                      tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")}k` : String(v))} />
                    <Tooltip formatter={(v: number) => money(v)} labelFormatter={(l) => `${data.granularity === "semana" ? "Semana de " : ""}${l}`}
                      contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="current" name="Atual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="previous" name="Anterior" fill="hsl(var(--copper) / 0.35)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </SectionCard>

            <div className="space-y-6">
              <SectionCard title="Próximos agendamentos" actions={<Link to="/agenda" className="text-xs font-semibold hover:underline">Agenda</Link>} bodyClassName="p-0 pb-2">
                {data.upcoming.length === 0 && <p className="px-5 pb-4 text-sm text-muted-foreground">Nada marcado daqui para frente.</p>}
                <ul>
                  {data.upcoming.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-sm first:border-0">
                      <span className="flex w-14 shrink-0 flex-col text-xs">
                        <span className="font-semibold tabular-nums">{fmt(a.starts_at, "HH:mm", tz)}</span>
                        <span className="text-muted-foreground">{fmt(a.starts_at, "dd/MM", tz)}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.client_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{[a.services, a.professional].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[a.status] ?? a.status}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard title="Aniversariantes da semana" hint="Próximos 7 dias" bodyClassName="p-0 pb-2">
                {data.birthdays.length === 0 && <p className="px-5 pb-4 text-sm text-muted-foreground">Ninguém faz aniversário nos próximos 7 dias.</p>}
                <ul>
                  {data.birthdays.map((b) => (
                    <li key={b.id} className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-sm first:border-0">
                      <Cake className="h-4 w-4 shrink-0 text-copper" />
                      <Link to={`/clientes/${b.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{b.name}</Link>
                      <span className="text-xs text-muted-foreground">{formatPhone(b.phone)}</span>
                      <span className="w-20 text-right text-xs tabular-nums">{dm(b.date)} · {b.age} anos</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>
          </div>
          <p className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" /> Datas e horas no fuso do salão ({tz}).
          </p>
        </>
      )}
    </div>
  );
}
