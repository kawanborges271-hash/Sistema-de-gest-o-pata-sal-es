import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProfessionalServices, useProfessionals, useServices } from "@/hooks/useCatalog";
import { useClientPackages, usePackages, useProducts } from "@/hooks/useStock";
import { useAddOrderItem } from "@/hooks/useFinance";
import { stockLabel } from "@/lib/finance";
import { money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { OrderItemKind } from "@/lib/types";

const TITLE: Record<OrderItemKind, string> = { servico: "Lançar serviço", produto: "Vender produto", pacote: "Vender pacote" };

/** Lança serviço, produto ou pacote numa comanda aberta. Preço sugerido vem do cadastro. */
export function AddItemDialog({ open, onOpenChange, orderId, clientId, kind, reservedBalances }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orderId: string;
  clientId: string | null;
  kind: OrderItemKind;
  /** sessões de pacote já lançadas nesta comanda (ainda não baixadas) */
  reservedBalances: Record<string, number>;
}) {
  const { data: services = [] } = useServices();
  const { data: pros = [] } = useProfessionals();
  const { data: links = [] } = useProfessionalServices();
  const { data: products = [] } = useProducts();
  const { data: packages = [] } = usePackages();
  const { data: balances = [] } = useClientPackages(clientId ?? undefined);
  const add = useAddOrderItem();

  const [refId, setRefId] = useState("");
  const [proId, setProId] = useState<string>("none");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [useBalance, setUseBalance] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setRefId("");
      setProId("none");
      setQty("1");
      setPrice("");
      setUseBalance(null);
    }
  }, [open]);

  const activeServices = services.filter((s) => s.active);
  const service = services.find((s) => s.id === refId);
  const product = products.find((p) => p.id === refId);
  const pkg = packages.find((p) => p.id === refId);

  const prosForService = useMemo(() => {
    if (kind !== "servico" || !refId) return pros.filter((p) => p.active);
    const ids = new Set(links.filter((l) => l.service_id === refId).map((l) => l.professional_id));
    return pros.filter((p) => p.active && (ids.size === 0 || ids.has(p.id)));
  }, [kind, refId, pros, links]);

  const availableBalances = balances.filter(
    (b) => b.usable && b.service_id === refId && b.sessions_left - (reservedBalances[b.balance_id] ?? 0) > 0,
  );

  // Preço sugerido: do profissional, do serviço, do produto ou do pacote
  useEffect(() => {
    if (kind === "servico" && service) {
      const own = links.find((l) => l.service_id === service.id && l.professional_id === proId)?.price;
      setPrice(String(own ?? service.price));
    } else if (kind === "produto" && product) setPrice(String(product.sale_price));
    else if (kind === "pacote" && pkg) setPrice(String(pkg.price));
  }, [kind, service, product, pkg, proId, links]);

  useEffect(() => {
    setUseBalance(availableBalances[0]?.balance_id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refId, balances.length]);

  const submit = async () => {
    if (!refId) return toast.error("Escolha o item");
    if (kind === "servico" && proId === "none") return toast.error("Escolha quem fez o serviço");
    if (kind === "pacote" && !clientId) return toast.error("Escolha a cliente da comanda antes de vender um pacote");
    const q = Number(qty.replace(",", "."));
    const p = Number(price.replace(",", "."));
    if (!q || q <= 0) return toast.error("Quantidade inválida");
    if (Number.isNaN(p) || p < 0) return toast.error("Preço inválido");
    try {
      await add.mutateAsync({
        order_id: orderId,
        kind,
        service_id: kind === "servico" ? refId : undefined,
        product_id: kind === "produto" ? refId : undefined,
        package_id: kind === "pacote" ? refId : undefined,
        professional_id: proId === "none" ? null : proId,
        quantity: kind === "pacote" ? 1 : q,
        unit_price: p,
        client_package_balance_id: kind === "servico" && useBalance ? useBalance : null,
      });
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">{TITLE[kind]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{kind === "servico" ? "Serviço" : kind === "produto" ? "Produto" : "Pacote"}</Label>
            <Select value={refId} onValueChange={setRefId}>
              <SelectTrigger><SelectValue placeholder="Escolha…" /></SelectTrigger>
              <SelectContent>
                {kind === "servico" && activeServices.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name} · {money(Number(s.price))}</SelectItem>
                ))}
                {kind === "produto" && products.filter((p) => p.active && p.for_sale).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · {money(Number(p.sale_price))} · {stockLabel(p, Number(p.current_stock))}</SelectItem>
                ))}
                {kind === "pacote" && packages.filter((p) => p.active).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} · {money(Number(p.price))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {kind === "pacote" && packages.filter((p) => p.active).length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum pacote cadastrado. Cadastre em Pacotes.</p>
            )}
            {kind === "produto" && product && Number(product.current_stock) <= 0 && (
              <p className="text-xs text-warning">Estoque zerado no sistema. A venda fica registrada e o saldo fica negativo até a próxima entrada.</p>
            )}
          </div>

          {kind !== "pacote" && (
            <div className="space-y-2">
              <Label>{kind === "servico" ? "Quem fez" : "Quem vendeu (comissão, opcional)"}</Label>
              <Select value={proId} onValueChange={setProId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {kind === "produto" && <SelectItem value="none">Ninguém (sem comissão)</SelectItem>}
                  {kind === "servico" && <SelectItem value="none" disabled>Escolha…</SelectItem>}
                  {prosForService.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === "servico" && availableBalances.length > 0 && (
            <div className="space-y-2 rounded-xl border border-copper/40 bg-accent/40 p-3 text-sm">
              <div className="font-medium">A cliente tem pacote para este serviço</div>
              {availableBalances.map((b) => (
                <label key={b.balance_id} className="flex items-center gap-2">
                  <input type="radio" name="balance" checked={useBalance === b.balance_id} onChange={() => setUseBalance(b.balance_id)} />
                  Usar sessão de "{b.package_name}" (restam {b.sessions_left - (reservedBalances[b.balance_id] ?? 0)})
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input type="radio" name="balance" checked={useBalance === null} onChange={() => setUseBalance(null)} />
                Cobrar normalmente
              </label>
            </div>
          )}

          <div className={cn("grid gap-3", kind === "pacote" ? "grid-cols-1" : "grid-cols-2")}>
            {kind !== "pacote" && (
              <div className="space-y-2">
                <Label htmlFor="item-qty">Quantidade</Label>
                <Input id="item-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="item-price">Preço unitário (R$)</Label>
              <Input id="item-price" inputMode="decimal" value={useBalance && kind === "servico" ? "0" : price}
                disabled={Boolean(useBalance && kind === "servico")} onChange={(e) => setPrice(e.target.value)} />
              {service?.price_is_starting && <p className="text-xs text-muted-foreground">Preço "a partir de": ajuste o valor final.</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={add.isPending}>Lançar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
