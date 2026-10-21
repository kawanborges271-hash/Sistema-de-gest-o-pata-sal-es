import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddStockMovement } from "@/hooks/useStock";
import { stockLabel } from "@/lib/finance";
import { errorMessage } from "@/lib/errors";
import type { Product } from "@/lib/types";

export type ManualStockKind = "entrada" | "ajuste" | "perda";

const TITLE: Record<ManualStockKind, string> = { entrada: "Entrada de estoque", ajuste: "Ajustar pela contagem", perda: "Registrar perda" };
const parse = (v: string) => Number(v.replace(",", "."));

/** Entrada (compra), ajuste pela contagem da prateleira ou perda (venceu, quebrou). */
export function StockMovementDialog({ product, kind, onClose }: { product: Product | null; kind: ManualStockKind; onClose: () => void }) {
  const add = useAddStockMovement();
  const [packs, setPacks] = useState("");
  const [notes, setNotes] = useState("");
  const [cost, setCost] = useState("");

  useEffect(() => {
    setPacks("");
    setNotes("");
    setCost(product ? String(Number(product.cost_price)) : "");
  }, [product, kind]);

  if (!product) return null;
  const size = Number(product.package_size);
  const qty = parse(packs || "0") * size;
  const current = Number(product.current_stock);
  const delta = kind === "entrada" ? qty : kind === "perda" ? -qty : qty - current;

  const submit = async () => {
    if (packs.trim() === "" || Number.isNaN(qty) || qty < 0 || (kind !== "ajuste" && qty === 0)) return toast.error("Informe a quantidade");
    if (delta === 0) return toast.error("A contagem bate com o sistema; nada a ajustar");
    try {
      await add.mutateAsync({
        product_id: product.id, kind, quantity: delta, notes: notes.trim() || undefined,
        unit_cost: kind === "entrada" && cost ? parse(cost) / size : undefined,
      });
      toast.success("Estoque atualizado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const unitWord = product.unit === "un" ? "unidades" : "embalagens";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="font-display font-medium">{TITLE[kind]}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl bg-muted/60 p-3 text-sm">
            <div className="font-medium">{product.name}</div>
            <div className="text-xs text-muted-foreground">No sistema: {stockLabel(product, current)}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mv-qty">
              {kind === "entrada" ? `Quantas ${unitWord} chegaram?` : kind === "perda" ? `Quantas ${unitWord} se perderam?` : `Quantas ${unitWord} há na prateleira?`}
            </Label>
            <Input id="mv-qty" autoFocus inputMode="decimal" value={packs} onChange={(e) => setPacks(e.target.value)} />
            {product.unit !== "un" && packs && <p className="text-xs text-muted-foreground">= {stockLabel(product, qty)}</p>}
            {kind === "ajuste" && packs && delta !== 0 && (
              <p className="text-xs text-muted-foreground">Ajuste de {delta > 0 ? "+" : ""}{stockLabel(product, delta)}</p>
            )}
          </div>
          {kind === "entrada" && (
            <div className="space-y-2">
              <Label htmlFor="mv-cost">Custo por embalagem nesta compra (R$)</Label>
              <Input id="mv-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="mv-notes">Observação</Label>
            <Input id="mv-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={kind === "entrada" ? "Ex.: NF 1234, fornecedor" : kind === "perda" ? "Ex.: venceu, caiu" : "Ex.: contagem mensal"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={add.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
