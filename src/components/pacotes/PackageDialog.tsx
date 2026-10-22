import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useServices } from "@/hooks/useCatalog";
import { useSavePackage, type PackageWithItems } from "@/hooks/useStock";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";

const parse = (v: string) => Number(v.replace(",", "."));

export function PackageDialog({ open, onOpenChange, pkg }: { open: boolean; onOpenChange: (o: boolean) => void; pkg?: PackageWithItems | null }) {
  const { data: services = [] } = useServices();
  const save = useSavePackage();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [validity, setValidity] = useState("");
  const [active, setActive] = useState(true);
  const [items, setItems] = useState<{ service_id: string; sessions: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    setName(pkg?.name ?? "");
    setDescription(pkg?.description ?? "");
    setPrice(pkg ? String(Number(pkg.price)) : "");
    setValidity(pkg?.validity_days ? String(pkg.validity_days) : "60");
    setActive(pkg?.active ?? true);
    setItems(pkg?.items.map((i) => ({ service_id: i.service_id, sessions: String(i.sessions) })) ?? [{ service_id: "", sessions: "4" }]);
  }, [open, pkg]);

  const full = items.reduce((a, i) => a + (services.find((s) => s.id === i.service_id)?.price ?? 0) * (parse(i.sessions) || 0), 0);
  const saving = full - (parse(price) || 0);

  const submit = async () => {
    if (!name.trim()) return toast.error("Dê um nome ao pacote");
    const valid = items.filter((i) => i.service_id && parse(i.sessions) > 0);
    if (!valid.length) return toast.error("Inclua pelo menos um serviço");
    if (new Set(valid.map((i) => i.service_id)).size !== valid.length) return toast.error("O mesmo serviço aparece duas vezes");
    if (Number.isNaN(parse(price)) || parse(price) < 0) return toast.error("Preço inválido");
    try {
      await save.mutateAsync({
        ...(pkg ? { id: pkg.id } : {}),
        name: name.trim(), description: description.trim() || null, price: parse(price),
        validity_days: validity ? Number(validity) : null, active,
        items: valid.map((i) => ({ service_id: i.service_id, sessions: Math.round(parse(i.sessions)) })),
      });
      toast.success(pkg ? "Pacote atualizado" : "Pacote criado");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle className="font-display font-medium">{pkg ? "Editar pacote" : "Novo pacote"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pk-name">Nome</Label>
            <Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: 4 escovas" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pk-desc">Descrição (opcional)</Label>
            <Input id="pk-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Serviços incluídos</Label>
            {items.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select value={it.service_id} onValueChange={(v) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, service_id: v } : x)))}>
                  <SelectTrigger className="flex-1"><SelectValue placeholder="Serviço" /></SelectTrigger>
                  <SelectContent>{services.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
                <Input aria-label="Sessões" className="w-20" inputMode="numeric" value={it.sessions}
                  onChange={(e) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, sessions: e.target.value } : x)))} />
                <span className="text-xs text-muted-foreground">sessões</span>
                <Button size="icon" variant="ghost" aria-label="Remover serviço" onClick={() => setItems((l) => l.filter((_, j) => j !== idx))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={() => setItems((l) => [...l, { service_id: "", sessions: "4" }])}><Plus className="mr-1 h-4 w-4" /> Serviço</Button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="pk-price">Preço do pacote (R$)</Label>
              <Input id="pk-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pk-val">Validade (dias)</Label>
              <Input id="pk-val" inputMode="numeric" value={validity} onChange={(e) => setValidity(e.target.value)} placeholder="Sem validade" />
            </div>
          </div>
          {full > 0 && (
            <p className="text-sm text-muted-foreground">
              Avulso sairia {money(full)}.{saving > 0 ? ` A cliente economiza ${money(saving)}.` : ""}
            </p>
          )}
          {pkg && (
            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              <span>À venda<span className="block text-xs text-muted-foreground">Desligado, quem já comprou continua usando.</span></span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
