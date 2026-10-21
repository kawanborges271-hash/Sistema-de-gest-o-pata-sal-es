import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Clock, Layers, Plus, Repeat, Scissors, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { ServiceDialog } from "@/components/servicos/ServiceDialog";
import { useCategories, useSaveService, useServices } from "@/hooks/useCatalog";
import { usePermissions } from "@/hooks/usePermissions";
import { minutesLabel, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Service } from "@/lib/types";

export default function Servicos() {
  const { data: services = [], isLoading } = useServices();
  const { data: categories = [] } = useCategories();
  const { can } = usePermissions();
  const editable = can("servicos.editar");
  const save = useSaveService();
  const [params, setParams] = useSearchParams();
  const [category, setCategory] = useState<string>("todas");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [open, setOpen] = useState(false);

  // Abrir direto pela busca global (?servico=id)
  useEffect(() => {
    const id = params.get("servico");
    const s = id && services.find((x) => x.id === id);
    if (s && editable) {
      setEditing(s);
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, services, editable, setParams]);

  const active = services.filter((s) => s.active);
  const avgPrice = active.length ? active.reduce((a, s) => a + Number(s.price), 0) / active.length : null;
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Sem categoria";

  const filtered = useMemo(
    () =>
      services
        .filter((s) => showInactive || s.active)
        .filter((s) => category === "todas" || (s.category_id ?? "none") === category)
        .filter((s) => s.name.toLowerCase().includes(search.trim().toLowerCase())),
    [services, showInactive, category, search],
  );

  const groups = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const s of filtered) {
      const k = catName(s.category_id);
      map.set(k, [...(map.get(k) ?? []), s]);
    }
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, categories]);

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  return (
    <div>
      <PageHeader
        eyebrow="Cadastros · Serviços"
        title="O que seu salão oferece, e quanto tempo cada coisa leva."
        subtitle="A duração alimenta a agenda e o intervalo de retorno avisa quando a cliente precisa voltar."
        actions={editable && <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Novo serviço</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Serviços ativos" value={num(active.length)} formula="Serviços marcados como ativos" icon={Scissors} highlight />
        <KpiCard label="Categorias" value={num(new Set(active.map((s) => s.category_id ?? "none")).size || null)} formula="Categorias com serviço ativo" icon={Layers} />
        <KpiCard label="Preço médio" value={money(avgPrice)} formula="Soma dos preços ÷ serviços ativos" icon={Tag} />
      </div>

      {services.length === 0 && !isLoading ? (
        <EmptyState
          icon={Scissors}
          title="Nenhum serviço cadastrado"
          description="Cadastre os serviços com duração e preço para começar a marcar horários."
          action={editable && <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> Cadastrar o primeiro</Button>}
        />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input placeholder="Buscar serviço…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full sm:w-60" />
            {[{ id: "todas", name: "Todas" }, ...categories].map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs transition-colors",
                  category === c.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted",
                )}
              >
                {c.name}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showInactive} onCheckedChange={setShowInactive} /> Mostrar inativos
            </label>
          </div>

          <div className="space-y-6">
            {groups.map(([name, list]) => (
              <div key={name}>
                <div className="label-caps mb-2">{name}</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((s) => (
                    <button
                      key={s.id}
                      disabled={!editable}
                      onClick={() => { setEditing(s); setOpen(true); }}
                      className={cn(
                        "rounded-2xl border border-border bg-card p-4 text-left shadow-soft transition-shadow enabled:hover:shadow-elev",
                        !s.active && "opacity-55",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium">{s.name}</div>
                        <div className="whitespace-nowrap font-display">
                          {s.price_is_starting && <span className="mr-1 text-xs text-muted-foreground">a partir de</span>}
                          {money(Number(s.price))}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {minutesLabel(s.duration_minutes)}</span>
                        <span className="inline-flex items-center gap-1"><Repeat className="h-3.5 w-3.5" /> {s.return_interval_days ? `retorno em ${s.return_interval_days} dias` : "sem retorno"}</span>
                        <span>comissão {num(Number(s.default_commission_pct))}%</span>
                        {!s.active && <span className="font-medium text-foreground">inativo</span>}
                      </div>
                      {editable && !s.active && (
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); save.mutate({ id: s.id, active: true }); }}
                          className="mt-3 inline-block text-xs font-semibold text-accent-foreground hover:underline"
                        >
                          Reativar
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {groups.length === 0 && <p className="text-sm text-muted-foreground">Nenhum serviço com esse filtro.</p>}
          </div>
        </>
      )}

      <ServiceDialog open={open} onOpenChange={setOpen} service={editing} />
    </div>
  );
}
