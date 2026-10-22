import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Building2, CalendarCheck, Copy, LogOut, MessageCircle, Plus, Search, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { SectionCard } from "@/components/common/SectionCard";
import { MoveUserDialog, type MoveTarget } from "@/components/painel/MoveUserDialog";
import { NewSalonDialog } from "@/components/painel/NewSalonDialog";
import { PlansTab } from "@/components/painel/PlansTab";
import { SalonSheet } from "@/components/painel/SalonSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatformAudit, usePlatformOverview, usePlatformSalons, usePlatformUserSearch } from "@/hooks/usePlatform";
import { ROLE_LABEL } from "@/lib/agenda";
import { num, timeAgo } from "@/lib/format";
import { AUDIT_ACTION_LABEL, limitLabel, nearLimit, WHATSAPP_LABEL } from "@/lib/platform";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { PlatformSalon } from "@/lib/types";

type Filter = "todos" | "ativos" | "suspensos";

export default function Painel() {
  const { profile, user, memberships, signOut } = useAuth();
  const { data: overview } = usePlatformOverview();
  const { data: salons = [], isLoading } = usePlatformSalons();
  const [term, setTerm] = useState("");
  const [filter, setFilter] = useState<Filter>("todos");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [move, setMove] = useState<MoveTarget | null>(null);

  const shown = useMemo(() => {
    const t = term.trim().toLowerCase();
    return salons.filter((s) =>
      (filter === "todos" || (filter === "ativos" ? !s.suspended_at : Boolean(s.suspended_at))) &&
      (!t || [s.name, s.slug, s.owner_email, s.owner_name].some((v) => v?.toLowerCase().includes(t))));
  }, [salons, term, filter]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-8">
        <Logo />
        <span className="hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold sm:flex">
          <ShieldCheck className="h-3.5 w-3.5 text-copper" /> Painel SaaS
        </span>
        <div className="ml-auto flex items-center gap-2">
          {memberships.length > 0 && (
            <Button asChild variant="ghost" size="sm"><Link to="/agenda"><ArrowLeft className="mr-1.5 h-4 w-4" />Voltar ao salão</Link></Button>
          )}
          <span className="hidden text-sm text-muted-foreground md:inline">{profile?.full_name || user?.email}</span>
          <Button variant="ghost" size="icon" aria-label="Sair" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        <PageHeader
          eyebrow="Plataforma · Super admin"
          title="Salões, planos e acesso"
          subtitle="Uso de cada salão em contagens e datas. Faturamento, caixa e comissões dos salões não aparecem aqui."
          actions={<Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" />Novo salão</Button>}
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard highlight label="Salões ativos" icon={Building2} value={num(overview?.active ?? null)}
            formula={`${num(overview?.salons ?? null)} no total · ${num(overview?.suspended ?? null)} suspensos`} />
          <KpiCard label="Novos em 30 dias" icon={Plus} value={num(overview?.new_30d ?? null)} formula="Salões criados no período" />
          <KpiCard label="Usuários ativos" icon={Users} value={num(overview?.users ?? null)} formula="Pessoas com acesso a algum salão" />
          <KpiCard label="WhatsApp conectado" icon={MessageCircle} value={num(overview?.whatsapp_connected ?? null)} formula="Integrações ligadas e conectadas" />
          <KpiCard label="Agendamentos em 30 dias" icon={CalendarCheck} value={num(overview?.appointments_30d ?? null)} formula="Criados em todos os salões" />
        </div>

        <Tabs defaultValue="saloes" className="mt-8">
          <TabsList>
            <TabsTrigger value="saloes">Salões</TabsTrigger>
            <TabsTrigger value="usuarios">Usuários</TabsTrigger>
            <TabsTrigger value="planos">Planos</TabsTrigger>
            <TabsTrigger value="historico">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="saloes" className="pt-4">
            <SectionCard bodyClassName="p-0">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <div className="relative min-w-[16rem] flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input className="pl-9" placeholder="Buscar por salão, link ou dono" aria-label="Buscar salão" value={term} onChange={(e) => setTerm(e.target.value)} />
                </div>
                <ToggleGroup type="single" value={filter} onValueChange={(v) => v && setFilter(v as Filter)} className="rounded-xl border border-border p-1">
                  {(["todos", "ativos", "suspensos"] as Filter[]).map((f) => (
                    <ToggleGroupItem key={f} value={f} className="h-8 rounded-lg px-3 text-xs capitalize">{f}</ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-sm">
                  <thead className="label-caps text-left">
                    <tr className="border-y border-border">
                      {["Salão", "Plano", "Equipe", "Profissionais", "Clientes", "Agend. 30d", "Leads 30d", "Mensagens no mês", "WhatsApp", "Última atividade"].map((h, i) => (
                        <th key={h} className={cn("px-3 py-2.5 font-medium", i === 0 ? "pl-5" : i > 1 && i < 8 ? "text-right" : "")}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading && <tr><td colSpan={10} className="p-5 text-muted-foreground">Carregando…</td></tr>}
                    {!isLoading && shown.length === 0 && <tr><td colSpan={10} className="p-5 text-muted-foreground">Nenhum salão encontrado.</td></tr>}
                    {shown.map((s) => <SalonRow key={s.id} s={s} onOpen={() => setOpenId(s.id)} />)}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </TabsContent>

          <TabsContent value="usuarios" className="pt-4">
            <UsersTab onMove={setMove} />
          </TabsContent>

          <TabsContent value="planos" className="pt-4">
            <PlansTab salons={salons} />
          </TabsContent>

          <TabsContent value="historico" className="pt-4">
            <AuditTab />
          </TabsContent>
        </Tabs>
      </main>

      <SalonSheet salon={salons.find((s) => s.id === openId) ?? null} onClose={() => setOpenId(null)} onMove={setMove} />
      <NewSalonDialog open={creating} onOpenChange={setCreating} />
      <MoveUserDialog target={move} salons={salons} onClose={() => setMove(null)} />
    </div>
  );
}

function SalonRow({ s, onOpen }: { s: PlatformSalon; onOpen: () => void }) {
  return (
    <tr className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/40" onClick={onOpen}>
      <td className="py-3 pl-5 pr-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{s.name}</span>
          {s.suspended_at && <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">Suspenso</span>}
          {!s.onboarding_completed && !s.suspended_at && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">Configurando</span>}
        </div>
        <div className="text-xs text-muted-foreground">{s.owner_email ?? "sem dono ativo"}</div>
      </td>
      <td className="px-3">{s.plan_name}</td>
      <td className="px-3 text-right tabular-nums">{num(s.team)}</td>
      <td className={cn("px-3 text-right tabular-nums", nearLimit(s.professionals, s.max_professionals) && "font-semibold text-amber-600")}>
        {limitLabel(s.professionals, s.max_professionals)}
      </td>
      <td className="px-3 text-right tabular-nums">{num(s.clients)}</td>
      <td className="px-3 text-right tabular-nums">{num(s.appointments_30d)}</td>
      <td className="px-3 text-right tabular-nums">{num(s.leads_30d)}</td>
      <td className={cn("px-3 text-right tabular-nums", nearLimit(s.messages_month, s.max_messages_month) && "font-semibold text-amber-600")}>
        {limitLabel(s.messages_month, s.max_messages_month)}
      </td>
      <td className="px-3 text-xs">{s.whatsapp_status ? WHATSAPP_LABEL[s.whatsapp_status] : "—"}</td>
      <td className="px-3 pr-5 text-xs text-muted-foreground">{timeAgo(s.last_activity_at)}</td>
    </tr>
  );
}

function UsersTab({ onMove }: { onMove: (t: MoveTarget) => void }) {
  const [term, setTerm] = useState("");
  const { data: users = [], isFetching } = usePlatformUserSearch(term);
  return (
    <SectionCard title="Usuários" hint="Busque por nome ou e-mail para mover alguém de salão ou dar acesso a outro." bodyClassName="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Nome ou e-mail (2 letras ou mais)" aria-label="Buscar usuário" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      {term.trim().length >= 2 && !isFetching && users.length === 0 && <p className="text-sm text-muted-foreground">Ninguém encontrado.</p>}
      <ul className="divide-y divide-border rounded-xl border border-border">
        {users.map((u) => (
          <li key={u.user_id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{u.full_name || u.email}</div>
              <div className="text-xs text-muted-foreground">{u.email} · último acesso {timeAgo(u.last_sign_in_at)}</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {u.memberships.length === 0 && <span className="text-xs text-muted-foreground">Sem salão</span>}
                {u.memberships.map((m) => (
                  <span key={m.salon_id} className={cn("rounded-full border px-2.5 py-0.5 text-xs", m.active ? "border-border" : "border-dashed text-muted-foreground line-through")}>
                    {m.salon_name} · {ROLE_LABEL[m.role]}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {u.memberships.filter((m) => m.active).map((m) => (
                <Button key={m.salon_id} size="sm" variant="outline"
                  onClick={() => onMove({ userId: u.user_id, name: u.full_name || u.email, fromSalonId: m.salon_id, fromSalonName: m.salon_name, role: m.role })}>
                  Mover de {m.salon_name}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onClick={() => onMove({ userId: u.user_id, name: u.full_name || u.email, fromSalonId: null, fromSalonName: null, role: "recepcao" })}>
                <UserPlus className="mr-1.5 h-4 w-4" />Dar acesso a outro salão
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function AuditTab() {
  const { data: rows = [] } = usePlatformAudit(100);
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => toast.success("Copiado"));
  return (
    <SectionCard title="Histórico do painel" hint="Toda ação do suporte fica registrada com autor e data. Nada é apagado." bodyClassName="p-0">
      {rows.length === 0 && <p className="p-5 text-sm text-muted-foreground">Nenhuma ação ainda.</p>}
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="flex items-start gap-3 border-t border-border px-5 py-3 text-sm first:border-0">
            <span className="w-28 shrink-0 text-xs text-muted-foreground">{fmt(r.created_at, "dd/MM/yy HH:mm")}</span>
            <div className="min-w-0 flex-1">
              <div>
                <b>{AUDIT_ACTION_LABEL[r.action] ?? r.action}</b>
                {r.salon_name && <> · {r.salon_name}</>}
                {r.target_email && <> · {r.target_email}</>}
              </div>
              <div className="truncate text-xs text-muted-foreground">por {r.actor_name ?? "sistema"} · {describe(r.details)}</div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Copiar detalhes" onClick={() => copy(JSON.stringify(r.details))}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function describe(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(" · ") || "—";
}
