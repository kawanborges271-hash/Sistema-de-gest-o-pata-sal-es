import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlarmClock, Plus, RotateCcw, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { LifecycleBadge } from "@/components/common/StatusBadge";
import { ClientDialog } from "@/components/clientes/ClientDialog";
import { useClientOverview } from "@/hooks/useClients";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { CLIENT_ORIGIN_LABEL, LIFECYCLE_LABEL } from "@/lib/agenda";
import { EMPTY, formatPhone, money, num } from "@/lib/format";
import { fmtDate } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { ClientOverview, LifecycleStatus } from "@/lib/types";

type Filter = LifecycleStatus | "todos" | "retorno";

const isOverdue = (c: ClientOverview) => Boolean(c.next_return_at && !c.next_appointment_at && new Date(c.next_return_at) < new Date());

export default function Clientes() {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const { data: clients = [], isLoading } = useClientOverview();
  const { can } = usePermissions();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filtro") as Filter) || "todos";
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [open, setOpen] = useState(false);

  const base = clients.filter((c) => (archived ? c.archived_at : !c.archived_at));
  const kpi = {
    total: base.length,
    ativos: base.filter((c) => c.lifecycle_status === "ativo").length,
    novos: base.filter((c) => c.lifecycle_status === "novo").length,
    recuperaveis: base.filter((c) => c.lifecycle_status === "em_risco" || c.lifecycle_status === "inativo").length,
    retorno: base.filter(isOverdue).length,
  };

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return base
      .filter((c) => filter === "todos" || (filter === "retorno" ? isOverdue(c) : c.lifecycle_status === filter))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (digits.length >= 3 && c.phone?.includes(digits)))
      .sort((a, b) =>
        filter === "retorno" || filter === "em_risco" || filter === "inativo"
          ? Number(b.total_spent ?? 0) - Number(a.total_spent ?? 0) // quem mais gastou primeiro
          : a.name.localeCompare(b.name),
      );
  }, [base, filter, search]);

  const setFilter = (f: Filter) => setParams(f === "todos" ? {} : { filtro: f }, { replace: true });

  return (
    <div>
      <PageHeader
        eyebrow="Operação · Clientes"
        title="Quem vem, quanto gasta e quando deve voltar."
        subtitle="O status muda sozinho conforme as visitas. Recuperáveis e hora de retocar são as listas que mais trazem faturamento de volta."
        actions={can("clientes.editar") && <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> Nova cliente</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Clientes na base" value={num(kpi.total)} formula="Cadastros não arquivados" icon={Users} highlight />
        <KpiCard label="Clientes ativos" value={num(kpi.ativos)} formula="Visita nos últimos 60 dias ou horário marcado" />
        <KpiCard label="Novos leads" value={num(kpi.novos)} formula="Cadastradas que ainda não vieram" icon={UserPlus} />
        <KpiCard label="Recuperáveis" value={num(kpi.recuperaveis)} formula="Sem visita há mais de 60 dias" icon={RotateCcw} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar por nome ou telefone…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full sm:w-64" />
        {(["todos", "retorno", "novo", "agendado", "ativo", "em_risco", "inativo", "perdido"] as Filter[]).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors",
              filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
            {f === "retorno" && <AlarmClock className="h-3.5 w-3.5" />}
            {f === "todos" ? "Todos" : f === "retorno" ? `Hora de retocar (${kpi.retorno})` : LIFECYCLE_LABEL[f]}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={archived} onCheckedChange={setArchived} /> Arquivados
        </label>
      </div>

      {clients.length === 0 && !isLoading ? (
        <EmptyState icon={Users} title="Sua base de clientes está vazia"
          description="Cadastre clientes aqui ou direto ao criar um agendamento."
          action={can("clientes.editar") && <Button onClick={() => setOpen(true)}><Plus className="mr-1 h-4 w-4" /> Cadastrar cliente</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-soft">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                {["Cliente", "Status", "Origem", "Último atendimento", "Total gasto", "Frequência", "Próximo retorno", "Próximo horário"].map((h) => (
                  <th key={h} className="label-caps px-4 py-3 font-normal">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((c) => (
                <tr key={c.id} onClick={() => navigate(`/clientes/${c.id}`)} className="cursor-pointer hover:bg-muted/50">
                  <td className="px-4 py-3"><div className="font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{formatPhone(c.phone)}</div></td>
                  <td className="px-4 py-3"><LifecycleBadge status={c.lifecycle_status} /></td>
                  <td className="px-4 py-3 text-muted-foreground">{CLIENT_ORIGIN_LABEL[c.origin]}</td>
                  <td className="px-4 py-3">{c.last_visit_at ? fmtDate(c.last_visit_at, tz) : EMPTY}</td>
                  <td className="px-4 py-3">{money(c.total_spent === null ? null : Number(c.total_spent))}</td>
                  <td className="px-4 py-3">{c.avg_frequency_days ? `a cada ${c.avg_frequency_days} dias` : EMPTY}</td>
                  <td className={cn("px-4 py-3", isOverdue(c) && "font-medium text-warning")}>{c.next_return_at ? fmtDate(c.next_return_at, tz) : EMPTY}</td>
                  <td className="px-4 py-3">{c.next_appointment_at ? fmtDate(c.next_appointment_at, tz) : EMPTY}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">Nenhuma cliente com esse filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <ClientDialog open={open} onOpenChange={setOpen} onSaved={(id) => navigate(`/clientes/${id}`)} />
    </div>
  );
}
