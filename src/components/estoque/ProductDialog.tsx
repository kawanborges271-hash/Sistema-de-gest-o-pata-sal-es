import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSaveProduct } from "@/hooks/useStock";
import { errorMessage } from "@/lib/errors";
import type { Product, ProductUnit } from "@/lib/types";

const UNIT_LABEL: Record<ProductUnit, string> = { un: "Unidade", ml: "Mililitro (ml)", g: "Grama (g)" };

const empty = {
  name: "", brand: "", barcode: "", unit: "un" as ProductUnit, package_size: "1", for_sale: true, for_use: false,
  cost_price: "", sale_price: "", commission_pct: "0", min_packs: "1", initial_packs: "", active: true,
};

const parse = (v: string) => Number(String(v).replace(",", "."));

/**
 * Preços e mínimo são pedidos por embalagem (como a dona do salão compra);
 * o banco guarda o estoque na unidade base para baixar o consumo por serviço em ml/g.
 */
export function ProductDialog({ open, onOpenChange, product }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product | null }) {
  const save = useSaveProduct();
  const [f, setF] = useState(empty);

  useEffect(() => {
    if (!open) return;
    setF(product ? {
      name: product.name, brand: product.brand ?? "", barcode: product.barcode ?? "", unit: product.unit,
      package_size: String(Number(product.package_size)), for_sale: product.for_sale, for_use: product.for_use,
      cost_price: String(Number(product.cost_price)), sale_price: String(Number(product.sale_price)),
      commission_pct: String(Number(product.commission_pct)),
      min_packs: String(Number(product.min_stock) / Number(product.package_size)), initial_packs: "", active: product.active,
    } : empty);
  }, [open, product]);

  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((x) => ({ ...x, [k]: v }));
  const size = f.unit === "un" ? 1 : parse(f.package_size) || 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.name.trim()) return toast.error("Dê um nome ao produto");
    if (!f.for_sale && !f.for_use) return toast.error("Marque se é de revenda, de uso interno ou os dois");
    if (size <= 0) return toast.error("Informe o conteúdo da embalagem");
    try {
      await save.mutateAsync({
        ...(product ? { id: product.id } : {}),
        name: f.name.trim(), brand: f.brand.trim() || null, barcode: f.barcode.trim() || null,
        unit: f.unit, package_size: size, for_sale: f.for_sale, for_use: f.for_use,
        cost_price: parse(f.cost_price) || 0, sale_price: f.for_sale ? parse(f.sale_price) || 0 : 0,
        commission_pct: f.for_sale ? parse(f.commission_pct) || 0 : 0,
        min_stock: (parse(f.min_packs) || 0) * size, active: f.active,
        initial_stock: product ? undefined : (parse(f.initial_packs) || 0) * size,
      });
      toast.success(product ? "Produto atualizado" : "Produto cadastrado");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-display font-medium">{product ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="p-name">Nome</Label>
            <Input id="p-name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Shampoo reconstrutor 300ml" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-brand">Marca</Label>
              <Input id="p-brand" value={f.brand} onChange={(e) => set("brand", e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-bar">Código de barras</Label>
              <Input id="p-bar" value={f.barcode} onChange={(e) => set("barcode", e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              <span>Revenda<span className="block text-xs text-muted-foreground">Vendido no balcão</span></span>
              <Switch checked={f.for_sale} onCheckedChange={(v) => set("for_sale", v)} />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              <span>Uso interno<span className="block text-xs text-muted-foreground">Gasto nos serviços</span></span>
              <Switch checked={f.for_use} onCheckedChange={(v) => set("for_use", v)} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Controlar em</Label>
              <Select value={f.unit} onValueChange={(v) => setF((x) => ({ ...x, unit: v as ProductUnit, package_size: v === "un" ? "1" : x.package_size }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(UNIT_LABEL) as ProductUnit[]).map((u) => <SelectItem key={u} value={u}>{UNIT_LABEL[u]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {f.unit !== "un" && (
              <div className="space-y-2">
                <Label htmlFor="p-size">Conteúdo da embalagem ({f.unit})</Label>
                <Input id="p-size" inputMode="decimal" value={f.package_size} onChange={(e) => set("package_size", e.target.value)} placeholder="Ex.: 900" />
              </div>
            )}
          </div>
          {f.unit !== "un" && (
            <p className="-mt-2 text-xs text-muted-foreground">Em ml ou g, o consumo de cada serviço é baixado na medida certa (ex.: 30 ml de oxidante por coloração).</p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-cost">Custo por embalagem (R$)</Label>
              <Input id="p-cost" inputMode="decimal" value={f.cost_price} onChange={(e) => set("cost_price", e.target.value)} />
            </div>
            {f.for_sale && (
              <div className="space-y-2">
                <Label htmlFor="p-sale">Preço de venda (R$)</Label>
                <Input id="p-sale" inputMode="decimal" value={f.sale_price} onChange={(e) => set("sale_price", e.target.value)} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="p-min">Estoque mínimo (embalagens)</Label>
              <Input id="p-min" inputMode="decimal" value={f.min_packs} onChange={(e) => set("min_packs", e.target.value)} />
            </div>
            {f.for_sale && (
              <div className="space-y-2">
                <Label htmlFor="p-comm">Comissão na venda (%)</Label>
                <Input id="p-comm" inputMode="decimal" value={f.commission_pct} onChange={(e) => set("commission_pct", e.target.value)} />
              </div>
            )}
          </div>
          {!product && (
            <div className="space-y-2">
              <Label htmlFor="p-init">Quantas embalagens você tem hoje?</Label>
              <Input id="p-init" inputMode="decimal" value={f.initial_packs} onChange={(e) => set("initial_packs", e.target.value)} placeholder="0" />
            </div>
          )}
          {product && (
            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              <span>Ativo<span className="block text-xs text-muted-foreground">Inativo some das vendas, o histórico fica.</span></span>
              <Switch checked={f.active} onCheckedChange={(v) => set("active", v)} />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
