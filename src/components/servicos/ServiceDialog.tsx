import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCategories, useSaveCategory, useSaveService } from "@/hooks/useCatalog";
import { useProducts, useSaveServiceSupplies, useServiceSupplies } from "@/hooks/useStock";
import { errorMessage } from "@/lib/errors";
import type { Service } from "@/lib/types";

const empty = {
  name: "", description: "", category_id: null as string | null, duration_minutes: 60, price: 0,
  price_is_starting: false, return_interval_days: null as number | null, default_commission_pct: 0,
  online_booking: true, active: true,
};

export function ServiceDialog({ open, onOpenChange, service }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  service?: Service | null;
}) {
  const { data: categories = [] } = useCategories();
  const save = useSaveService();
  const saveCategory = useSaveCategory();
  const [form, setForm] = useState(empty);
  const [newCategory, setNewCategory] = useState("");
  const { data: products = [] } = useProducts();
  const { data: currentSupplies = [] } = useServiceSupplies(service?.id);
  const saveSupplies = useSaveServiceSupplies();
  const [supplies, setSupplies] = useState<{ product_id: string; quantity: string }[]>([]);
  const supplyProducts = products.filter((p) => p.active && p.for_use);

  useEffect(() => {
    if (open) setForm(service ? { ...empty, ...service, description: service.description ?? "" } : empty);
    setNewCategory("");
  }, [open, service]);

  useEffect(() => {
    if (open) setSupplies(service ? currentSupplies.map((x) => ({ product_id: x.product_id, quantity: String(Number(x.quantity)) })) : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, service, currentSupplies.length]);

  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error("Dê um nome ao serviço");
    if (form.duration_minutes < 5) return toast.error("Duração mínima de 5 minutos");
    try {
      let categoryId = form.category_id;
      if (newCategory.trim()) categoryId = await saveCategory.mutateAsync(newCategory);
      const id = await save.mutateAsync({
        ...(service ? { id: service.id } : {}),
        ...form,
        name: form.name.trim(),
        description: form.description.trim() || null,
        category_id: categoryId,
      });
      const validSupplies = supplies
        .filter((x) => x.product_id && Number(x.quantity.replace(",", ".")) > 0)
        .map((x) => ({ product_id: x.product_id, quantity: Number(x.quantity.replace(",", ".")) }));
      if (id && (service || validSupplies.length)) await saveSupplies.mutateAsync({ serviceId: id, supplies: validSupplies });
      toast.success(service ? "Serviço atualizado" : "Serviço criado");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">{service ? "Editar serviço" : "Novo serviço"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex.: Coloração raiz" />
          </div>
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={form.category_id ?? "none"} onValueChange={(v) => set("category_id", v === "none" ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem categoria</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="…ou crie uma nova categoria" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Duração (min)</Label>
              <Input type="number" min={5} step={5} value={form.duration_minutes} onChange={(e) => set("duration_minutes", Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Preço (R$)</Label>
              <Input type="number" min={0} step="0.01" value={form.price} onChange={(e) => set("price", Number(e.target.value))} />
            </div>
          </div>
          <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
            <span>
              Preço "a partir de"
              <span className="block text-xs text-muted-foreground">O valor final é definido no atendimento.</span>
            </span>
            <Switch checked={form.price_is_starting} onCheckedChange={(v) => set("price_is_starting", v)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Retorno (dias)</Label>
              <Input
                type="number" min={1} placeholder="Ex.: 30"
                value={form.return_interval_days ?? ""}
                onChange={(e) => set("return_interval_days", e.target.value ? Number(e.target.value) : null)}
              />
              <p className="text-xs text-muted-foreground">Base do lembrete "hora de retocar".</p>
            </div>
            <div className="space-y-2">
              <Label>Comissão padrão (%)</Label>
              <Input type="number" min={0} max={100} step="0.5" value={form.default_commission_pct} onChange={(e) => set("default_commission_pct", Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Descrição (opcional)</Label>
            <Textarea rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          {supplyProducts.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border p-3">
              <div className="text-sm">
                Produtos usados
                <span className="block text-xs text-muted-foreground">Baixados do estoque a cada atendimento pago. Ex.: 60 g de tinta e 90 ml de oxidante.</span>
              </div>
              {supplies.map((sp, idx) => {
                const prod = products.find((p) => p.id === sp.product_id);
                return (
                  <div key={idx} className="flex items-center gap-2">
                    <Select value={sp.product_id} onValueChange={(v) => setSupplies((l) => l.map((x, j) => (j === idx ? { ...x, product_id: v } : x)))}>
                      <SelectTrigger className="flex-1"><SelectValue placeholder="Produto" /></SelectTrigger>
                      <SelectContent>{supplyProducts.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input aria-label="Quantidade usada" className="w-20" inputMode="decimal" value={sp.quantity}
                      onChange={(e) => setSupplies((l) => l.map((x, j) => (j === idx ? { ...x, quantity: e.target.value } : x)))} />
                    <span className="w-6 text-xs text-muted-foreground">{prod?.unit ?? ""}</span>
                    <Button type="button" size="icon" variant="ghost" aria-label="Remover produto" onClick={() => setSupplies((l) => l.filter((_, j) => j !== idx))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              <Button type="button" size="sm" variant="outline" onClick={() => setSupplies((l) => [...l, { product_id: "", quantity: "" }])}>
                <Plus className="mr-1 h-4 w-4" /> Produto
              </Button>
            </div>
          )}
          <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
            <span>Aparece no agendamento online</span>
            <Switch checked={form.online_booking} onCheckedChange={(v) => set("online_booking", v)} />
          </label>
          <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
            <span>
              Ativo
              <span className="block text-xs text-muted-foreground">Inativo sai da agenda, mas o histórico fica.</span>
            </span>
            <Switch checked={form.active} onCheckedChange={(v) => set("active", v)} />
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
