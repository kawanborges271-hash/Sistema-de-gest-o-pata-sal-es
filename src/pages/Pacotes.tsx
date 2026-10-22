import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Gift, Package as PackageIcon, Plus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionCard } from "@/components/common/SectionCard";
import { PackageDialog } from "@/components/pacotes/PackageDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useServices } from "@/hooks/useCatalog";
import { usePermissions } from "@/hooks/usePermissions";
import { useClientPackages, usePackages, type PackageWithItems } from "@/hooks/useStock";
import { money, num } from "@/lib/format";
import { fmtDate } from "@/lib/tz";
import { cn } from "@/lib/utils";

export default function Pacotes() {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const { can } = usePermissions();
  const editable = can("pacotes.editar");
  const { data: packages = [], isLoading } = usePackages();
  const { data: balances = [] } = useClientPackages();
  const { data: services = [] } = useServices();
  const [editing, setEditing] = useState<PackageWithItems | null>(null);
  const [open, setOpen] = useState(false);

  const usable = balances.filter((b) => b.usable);
  const clientsWithBalance = new Set(usable.map((b) => b.client_id)).size;
  const sessionsLeft = usable.reduce((a, b) => a + b.sessions_left, 0);
  const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? "Serviço";
  const svcPrice = (id: string) => Number(services.find((s) => s.id === id)?.price ?? 0);

  // Uma linha por pacote comprado, com os saldos de cada serviço
  const bought = useMemo(() => {
    const map = new Map<string, typeof balances>();
    for (const b of balances) map.set(b.client_package_id, [...(map.get(b.client_package_id) ?? []), b]);
    return [...map.values()];
  }, [balances]);

  const soon = (iso: string | null) => Boolean(iso && new Date(iso).getTime() - Date.now() < 14 * 86400000 && new Date(iso) > new Date());

  return (
    <div>
      <PageHeader
        eyebrow="Cadastros · Pacotes"
        title="Sessões pagas adiantado, que trazem a cliente de volta."
        subtitle="Venda o pacote na comanda. Nas próximas visitas, a sessão sai do saldo sozinha quando a comanda é aberta pelo agendamento."
        actions={editable && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Novo pacote</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Pacotes à venda" value={num(packages.filter((p) => p.active).length)} formula="Pacotes ativos no cadastro" icon={PackageIcon} highlight />
        <KpiCard label="Clientes com saldo" value={num(clientsWithBalance)} formula="Com sessões a usar e dentro da validade" icon={Users} />
        <KpiCard label="Sessões a usar" value={num(sessionsLeft)} formula="Soma do que ainda falta usar" icon={CalendarClock} />
      </div>

      {packages.length === 0 && !isLoading ? (
        <EmptyState icon={Gift} title="Nenhum pacote cadastrado"
          description="Monte pacotes como 4 escovas ou mãos e pés mensal. A cliente paga uma vez e usa as sessões dentro da validade."
          action={editable && <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Criar o primeiro</Button>} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {packages.map((p) => {
            const full = p.items.reduce((a, i) => a + svcPrice(i.service_id) * i.sessions, 0);
            return (
              <button key={p.id} disabled={!editable} onClick={() => { setEditing(p); setOpen(true); }}
                className={cn("rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-shadow enabled:hover:shadow-elev", !p.active && "opacity-55")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium">{p.name}</div>
                  <div className="font-display">{money(Number(p.price))}</div>
                </div>
                <ul className="mt-2 space-y-0.5 text-sm text-muted-foreground">
                  {p.items.map((i) => <li key={i.service_id}>{i.sessions}× {svcName(i.service_id)}</li>)}
                </ul>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span>{p.validity_days ? `vale ${p.validity_days} dias` : "sem validade"}</span>
                  {full > Number(p.price) && <span className="text-success">economia de {money(full - Number(p.price))}</span>}
                  {!p.active && <span className="font-medium text-foreground">fora de venda</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <SectionCard title="Pacotes das clientes" className="mt-8" bodyClassName="p-0">
        {bought.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Quando uma cliente comprar um pacote, o saldo aparece aqui.</p>
        ) : (
          <div className="divide-y divide-border">
            {bought.map((rows) => {
              const b = rows[0];
              const expired = b.expires_at && new Date(b.expires_at) <= new Date();
              return (
                <div key={b.client_package_id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <Link to={`/clientes/${b.client_id}`} className="font-medium hover:underline sm:w-48 sm:truncate">{b.client_name}</Link>
                  <span className="flex-1 text-muted-foreground">
                    {b.package_name} · {rows.map((r) => `${r.service_name} ${r.sessions_used}/${r.sessions_total}`).join(" · ")}
                  </span>
                  <span className={cn("text-xs",
                    b.status === "cancelado" || expired ? "text-muted-foreground line-through" : soon(b.expires_at) ? "text-warning" : "text-muted-foreground")}>
                    {b.status === "cancelado" ? "cancelado" : b.expires_at ? `${expired ? "venceu" : "vence"} ${fmtDate(b.expires_at, tz)}` : "sem validade"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <PackageDialog open={open} onOpenChange={setOpen} pkg={editing} />
    </div>
  );
}
