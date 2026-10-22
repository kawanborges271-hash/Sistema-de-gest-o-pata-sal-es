import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, PackagePlus, Pencil, Plus, Scale, Trash, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { SectionCard } from "@/components/common/SectionCard";
import { ProductDialog } from "@/components/estoque/ProductDialog";
import { StockMovementDialog, type ManualStockKind } from "@/components/estoque/StockMovementDialog";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useProducts, useStockMovements } from "@/hooks/useStock";
import { STOCK_KIND_LABEL, stockLabel, stockLevel } from "@/lib/finance";
import { money, num } from "@/lib/format";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Product } from "@/lib/types";

type Filter = "todos" | "revenda" | "uso" | "baixo";
const FILTER_LABEL: Record<Filter, string> = { todos: "Todos", revenda: "Revenda", uso: "Uso interno", baixo: "Repor" };

const LEVEL_STYLE = {
  zerado: "bg-destructive/10 text-destructive",
  baixo: "bg-warning/12 text-warning",
  ok: "bg-success/10 text-success",
};

export default function Estoque() {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const { can } = usePermissions();
  const editable = can("estoque.editar");
  const { data: products = [], isLoading } = useProducts();
  const { data: movements = [] } = useStockMovements(undefined, 40);
  const [filter, setFilter] = useState<Filter>("todos");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [moving, setMoving] = useState<{ product: Product; kind: ManualStockKind } | null>(null);

  const active = products.filter((p) => p.active);
  const low = active.filter((p) => stockLevel(p) !== "ok");
  const value = active.reduce((a, p) => a + Math.max(0, Number(p.current_stock)) * (Number(p.cost_price) / Number(p.package_size)), 0);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products
      .filter((p) => showInactive || p.active)
      .filter((p) => filter === "todos" || (filter === "revenda" ? p.for_sale : filter === "uso" ? p.for_use : stockLevel(p) !== "ok"))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q) || p.barcode?.includes(q));
  }, [products, filter, search, showInactive]);

  const productName = (id: string) => products.find((p) => p.id === id);

  return (
    <div>
      <PageHeader
        eyebrow="Cadastros · Produtos & Estoque"
        title="O que está na prateleira, e o que precisa repor."
        subtitle="Vendas e o consumo dos serviços baixam o estoque sozinhos quando a comanda é paga. Aqui você lança as compras e confere a contagem."
        actions={editable && <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Novo produto</Button>}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Produtos ativos" value={num(active.length)} formula="Revenda e uso interno" icon={Boxes} highlight />
        <KpiCard label="Para repor" value={num(low.length)} formula="No mínimo ou abaixo dele" icon={AlertTriangle} />
        <KpiCard label="Valor em estoque" value={money(value)} formula="Saldo × custo de compra" icon={Wallet} />
      </div>

      {products.length === 0 && !isLoading ? (
        <EmptyState icon={Boxes} title="Nenhum produto cadastrado"
          description="Cadastre o que você revende e o que usa nos serviços (tintas, oxidante, esmaltes) para controlar o estoque."
          action={editable && <Button onClick={() => { setEditing(null); setDialogOpen(true); }}><Plus className="mr-1 h-4 w-4" /> Cadastrar o primeiro</Button>} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Input placeholder="Buscar por nome, marca ou código…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full sm:w-72" />
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn("rounded-full border px-3 py-1.5 text-xs transition-colors",
                  filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted")}>
                {FILTER_LABEL[f]}{f === "baixo" && low.length > 0 && ` (${low.length})`}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={showInactive} onCheckedChange={setShowInactive} /> Mostrar inativos
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((p) => {
              const level = stockLevel(p);
              return (
                <div key={p.id} className={cn("rounded-2xl border border-border bg-card p-4 shadow-soft", !p.active && "opacity-55")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {[p.brand, p.for_sale && "revenda", p.for_use && "uso interno"].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {p.for_sale && <div className="whitespace-nowrap font-display">{money(Number(p.sale_price))}</div>}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", LEVEL_STYLE[level])}>{stockLabel(p, Number(p.current_stock))}</span>
                    <span className="text-xs text-muted-foreground">mín. {stockLabel(p, Number(p.min_stock))}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" className="h-7" onClick={() => setMoving({ product: p, kind: "entrada" })}><PackagePlus className="mr-1 h-3.5 w-3.5" /> Entrada</Button>
                    {editable && <Button size="sm" variant="outline" className="h-7" onClick={() => setMoving({ product: p, kind: "ajuste" })}><Scale className="mr-1 h-3.5 w-3.5" /> Contagem</Button>}
                    {editable && <Button size="sm" variant="ghost" className="h-7" onClick={() => setMoving({ product: p, kind: "perda" })}><Trash className="mr-1 h-3.5 w-3.5" /> Perda</Button>}
                    {editable && <Button size="sm" variant="ghost" className="ml-auto h-7" aria-label="Editar produto" onClick={() => { setEditing(p); setDialogOpen(true); }}><Pencil className="h-3.5 w-3.5" /></Button>}
                  </div>
                </div>
              );
            })}
            {list.length === 0 && <p className="text-sm text-muted-foreground">Nenhum produto com esse filtro.</p>}
          </div>

          <SectionCard title="Últimas movimentações" className="mt-8" bodyClassName="p-0">
            {movements.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">As entradas, vendas e usos aparecem aqui.</p>
            ) : (
              <div className="divide-y divide-border">
                {movements.map((m) => {
                  const p = productName(m.product_id);
                  return (
                    <div key={m.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="w-24 shrink-0 text-xs text-muted-foreground">{fmt(m.created_at, "dd/MM HH:mm", tz)}</span>
                      <span className="min-w-0 flex-1 truncate">{p?.name ?? "Produto"}{m.notes && <span className="text-muted-foreground"> · {m.notes}</span>}</span>
                      <span className="hidden text-xs text-muted-foreground sm:inline">{STOCK_KIND_LABEL[m.kind]}</span>
                      <span className={cn("w-32 text-right font-medium", Number(m.quantity) > 0 ? "text-success" : "text-foreground")}>
                        {Number(m.quantity) > 0 ? "+" : ""}{p ? stockLabel({ unit: p.unit, package_size: 1 }, Number(m.quantity)) : Number(m.quantity)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </>
      )}

      <ProductDialog open={dialogOpen} onOpenChange={setDialogOpen} product={editing} />
      {moving && <StockMovementDialog product={moving.product} kind={moving.kind} onClose={() => setMoving(null)} />}
    </div>
  );
}
