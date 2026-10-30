import { Link, useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  BadgeDollarSign, CalendarCheck, Gauge, MessageCircle, Package, Percent, Phone, Sparkles, UserCheck, UserPlus, UserX, Wallet,
} from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { EmptyState } from "@/components/common/EmptyState";
import { Delta, MetricCard } from "@/components/insights/shared";
import { PeriodPicker, dm, usePeriod } from "@/components/insights/PeriodPicker";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useProfessionals } from "@/hooks/useCatalog";
import { useProfessionalPanel } from "@/hooks/useInsights";
import { STATUS_LABEL } from "@/lib/agenda";
import { MESSAGE_KIND_LABEL, QUEUE_STATUS_LABEL, QUEUE_STATUS_STYLE } from "@/lib/crm";
import { formatPhone, money, num } from "@/lib/format";
import { pct } from "@/lib/insights";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { ProfessionalPanel } from "@/lib/types";

const hours = (h: number) => `${num(Math.round(h))} h`;
const firstName = (n: string) => n.trim().split(/\s+/)[0];

/** Mensagem pronta para o profissional chamar a cliente pelo WhatsApp dele. */
function callMessage(c: ProfessionalPanel["to_call"][number], pro: string, salon: string) {
  const oi = `Oi, ${firstName(c.name)}! Aqui é ${firstName(pro)}, do ${salon}.`;
  if (c.reason === "retoque" && c.last_service) return `${oi} Já está na hora de refazer ${c.last_service}. Quer que eu separe um horário para você?`;
  return `${oi} Estou com saudade! Faz tempo que você não vem. Quer marcar um horário comigo?`;
}

export default function MeuPainel() {
  const { salon, role, professionalId: mine } = useAuth();
  const tz = salon!.timezone;
  const period = usePeriod(tz);
  const [params, setParams] = useSearchParams();
  const isAdmin = role === "admin";
  const { data: professionals = [] } = useProfessionals();
  // Dono sem cadastro de profissional abre direto o painel da primeira pessoa da equipe
  const chosen = isAdmin ? params.get("profissional") ?? (mine ? null : professionals.find((pr) => pr.active)?.id ?? null) : null;
  const { data, isLoading, error } = useProfessionalPanel(period.from, period.to, chosen);
  const c = data?.current;
  const p = data?.previous;
  const noLink = (error as { message?: string } | null)?.message?.startsWith("SEM_CADASTRO");

  const picker = isAdmin && (
    <Select value={chosen ?? mine ?? ""} onValueChange={(v) => setParams({ profissional: v }, { replace: true })}>
      <SelectTrigger className="h-9 w-52"><SelectValue placeholder="Escolha a profissional" /></SelectTrigger>
      <SelectContent>
        {professionals.map((pr) => <SelectItem key={pr.id} value={pr.id}>{pr.name}{!pr.active && " (inativo)"}</SelectItem>)}
      </SelectContent>
    </Select>
  );

  const header = (
    <PageHeader
      eyebrow={isAdmin ? "Vendas · Painel do profissional" : "Meu painel"}
      title={data ? (isAdmin ? `Resultado de ${data.professional.name}` : `Seu resultado, ${firstName(data.professional.name)}`) : isAdmin ? "Painel do profissional" : "Seu resultado"}
      subtitle={isAdmin
        ? "O mesmo painel que a pessoa vê no login dela."
        : "Só os seus números: o que você atendeu, faturou e tem a receber. Ninguém da equipe vê este painel, só você e o dono do salão."}
      actions={<div className="flex flex-wrap items-center gap-2">{picker}<PeriodPicker period={period} /></div>}
    />
  );

  if (noLink) {
    return (
      <div>
        {header}
        <EmptyState icon={UserX}
          title={isAdmin ? "Escolha uma profissional" : "Seu login ainda não está ligado à sua agenda"}
          description={isAdmin
            ? "Você não tem cadastro de profissional. Escolha acima de quem quer ver o painel."
            : "Peça ao dono do salão para ligar o seu login ao seu cadastro em Gestão · Equipe. Depois disso a sua agenda e os seus números aparecem aqui."} />
      </div>
    );
  }

  return (
    <div>
      {header}
      {error && <p className="mb-4 text-sm text-destructive">Não foi possível carregar o painel.</p>}
      {isLoading || !data || !c || !p ? (
        !error && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />)}</div>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {dm(c.from)} a {dm(c.to)} · comparando com {dm(p.from)} a {dm(p.to)}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard highlight label="Faturou" icon={BadgeDollarSign} value={money(c.revenue)}
              compare={<Delta current={c.revenue} previous={p.revenue} />} previousLabel={money(p.revenue)}
              formula="Serviços e produtos seus nas comandas fechadas" />
            <MetricCard label="Comissão do período" icon={Percent} value={money(c.commissions)}
              compare={<Delta current={c.commissions} previous={p.commissions} />} previousLabel={money(p.commissions)}
              formula={`A receber, somando tudo que está pendente: ${money(data.commissions_pending)}`} />
            <MetricCard label="Atendimentos" icon={CalendarCheck} value={num(c.attended)}
              compare={<Delta current={c.attended} previous={p.attended} />} previousLabel={num(p.attended)}
              formula={`${num(c.services_count)} serviços feitos · ${num(c.appointments)} horários marcados`} />
            <MetricCard label="Ticket médio" icon={Wallet} value={money(c.avg_ticket)}
              compare={<Delta current={c.avg_ticket} previous={p.avg_ticket} />} previousLabel={money(p.avg_ticket)}
              formula="O que você faturou ÷ comandas com você" />
            <MetricCard label="Comparecimento" icon={UserCheck} value={pct(c.attendance_rate)}
              compare={<Delta current={c.attendance_rate} previous={p.attendance_rate} points />} previousLabel={pct(p.attendance_rate)}
              formula={`${num(c.attended)} vieram · ${num(c.no_shows)} faltaram`} />
            <MetricCard label="Agenda ocupada" icon={Gauge} value={pct(c.occupancy)}
              compare={<Delta current={c.occupancy} previous={p.occupancy} points />} previousLabel={pct(p.occupancy)}
              formula={`${hours(c.booked_hours)} agendadas de ${hours(c.available_hours)} da sua jornada`} />
            <MetricCard label="Clientes atendidas" icon={UserPlus} value={num(c.clients)}
              compare={<Delta current={c.clients} previous={p.clients} />} previousLabel={num(p.clients)}
              formula={`${num(c.new_clients)} vieram com você pela primeira vez`} />
            <MetricCard label="Venda de produtos" icon={Package} value={money(c.product_revenue)}
              compare={<Delta current={c.product_revenue} previous={p.product_revenue} />} previousLabel={money(p.product_revenue)}
              formula="Produtos que você vendeu nas comandas" />
          </div>

          <div className="mt-6 grid gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <SectionCard title={`Seu faturamento por ${data.granularity === "semana" ? "semana" : "dia"}`}
                hint="Barras escuras: período atual. Claras: o mesmo dia/semana do período anterior.">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.series.map((s) => ({ ...s, label: dm(s.bucket) }))} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={12} />
                      <YAxis tickLine={false} axisLine={false} fontSize={11} width={52}
                        tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")}k` : String(v))} />
                      <Tooltip formatter={(v: number) => money(v)}
                        contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="current" name="Atual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="previous" name="Anterior" fill="hsl(var(--copper) / 0.35)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              <SectionCard title="Clientes para chamar de volta"
                hint="Clientes suas que passaram da data de refazer o serviço ou não vêm há mais de 60 dias, sem nada marcado no salão. O botão abre o WhatsApp com a mensagem pronta."
                bodyClassName="p-0 pb-2">
                {data.to_call.length === 0 && <p className="px-5 pb-4 text-sm text-muted-foreground">Ninguém para chamar agora. Suas clientes estão com horário marcado ou vieram há pouco.</p>}
                <ul>
                  {data.to_call.map((t) => (
                    <li key={t.client_id} className="flex flex-wrap items-center gap-3 border-t border-border px-5 py-2.5 text-sm first:border-0">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                        t.reason === "retoque" ? "bg-copper/15 text-copper" : "bg-muted text-muted-foreground")}>
                        {t.reason === "retoque" ? "Retoque" : "Sumiu"}
                      </span>
                      <span className="min-w-[140px] flex-1">
                        <Link to={`/clientes/${t.client_id}`} className="block truncate font-medium hover:underline">{t.name}</Link>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[t.last_service, `última vez ${fmt(t.last_visit_at, "dd/MM/yy", tz)}`].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{formatPhone(t.phone)}</span>
                      <Button asChild size="sm" variant="outline">
                        <a href={`https://wa.me/${t.phone.replace(/\D/g, "")}?text=${encodeURIComponent(callMessage(t, data.professional.name, salon!.name))}`}
                          target="_blank" rel="noreferrer">
                          <Phone className="mr-1 h-3.5 w-3.5" /> Chamar
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            </div>

            <div className="space-y-6">
              <SectionCard title="Sua agenda de hoje" actions={<Link to="/agenda" className="text-xs font-semibold hover:underline">Agenda</Link>} bodyClassName="p-0 pb-2">
                {data.today.length === 0 && <p className="px-5 pb-4 text-sm text-muted-foreground">Nenhum horário hoje.</p>}
                <ul>
                  {data.today.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-sm first:border-0">
                      <span className="w-12 shrink-0 text-xs font-semibold tabular-nums">{fmt(a.starts_at, "HH:mm", tz)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{a.client_name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{a.services}</span>
                      </span>
                      <span className="text-[11px] text-muted-foreground">{STATUS_LABEL[a.status] ?? a.status}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard title="O que você mais vende" hint="No período escolhido" bodyClassName="p-0 pb-2">
                {data.top_services.length === 0 && <p className="px-5 pb-4 text-sm text-muted-foreground">Nenhuma comanda fechada com você no período.</p>}
                <ul>
                  {data.top_services.map((s) => (
                    <li key={`${s.kind}-${s.name}`} className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-sm first:border-0">
                      {s.kind === "produto" ? <Package className="h-4 w-4 shrink-0 text-muted-foreground" /> : <Sparkles className="h-4 w-4 shrink-0 text-copper" />}
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{num(Number(s.quantity))}×</span>
                      <span className="w-24 text-right font-medium tabular-nums">{money(s.revenue)}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              <SectionCard title="Mensagens automáticas"
                hint="O que o sistema mandou ou vai mandar pelo WhatsApp para as clientes dos seus horários (últimos 30 dias e próximos 7)."
                bodyClassName="p-0 pb-2">
                <div className="grid grid-cols-3 gap-2 px-5 pb-3 text-center text-xs">
                  <div className="rounded-lg bg-muted/60 py-2"><div className="text-base font-semibold">{num(data.message_stats.sent)}</div>enviadas</div>
                  <div className="rounded-lg bg-muted/60 py-2"><div className="text-base font-semibold">{num(data.message_stats.scheduled)}</div>na fila</div>
                  <div className="rounded-lg bg-muted/60 py-2"><div className="text-base font-semibold">{num(data.message_stats.failed)}</div>falharam</div>
                </div>
                {data.messages.length === 0 && <p className="flex items-center gap-1.5 px-5 pb-4 text-sm text-muted-foreground"><MessageCircle className="h-4 w-4" /> Nenhuma mensagem no período.</p>}
                <ul>
                  {data.messages.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 border-t border-border px-5 py-2 text-xs">
                      <span className="w-20 shrink-0 tabular-nums text-muted-foreground">{fmt(m.at, "dd/MM HH:mm", tz)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{m.client_name ?? "Cliente"}</span>
                        <span className="block truncate text-muted-foreground">{MESSAGE_KIND_LABEL[m.kind] ?? m.kind}</span>
                      </span>
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-semibold", QUEUE_STATUS_STYLE[m.status])}>{QUEUE_STATUS_LABEL[m.status] ?? m.status}</span>
                    </li>
                  ))}
                </ul>
              </SectionCard>

              {!isAdmin && (
                <Link to="/comissoes" className="block rounded-2xl border border-border bg-card p-5 text-sm shadow-soft hover:shadow-elev">
                  <div className="label-caps">Comissão a receber</div>
                  <div className="mt-2 font-display text-2xl font-light">{money(data.commissions_pending)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">Ver o extrato de cada comanda em Comissões</div>
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
