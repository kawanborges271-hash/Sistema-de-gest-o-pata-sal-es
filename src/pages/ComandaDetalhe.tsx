import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CalendarDays, Coins, Gift, Package, Plus, Scissors, ShoppingBag, Trash2, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionCard } from "@/components/common/SectionCard";
import { OrderStatusBadge } from "@/components/common/StatusBadge";
import { ClientPicker } from "@/components/clientes/ClientPicker";
import { AddItemDialog } from "@/components/comandas/AddItemDialog";
import { PaymentDialog } from "@/components/comandas/PaymentDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useProfessionals } from "@/hooks/useCatalog";
import { usePaymentMethods, useCancelOrder, useOrder, useRemoveOrderItem, useUpdateOrder, useUpdateOrderItem } from "@/hooks/useFinance";
import { usePermissions } from "@/hooks/usePermissions";
import { useLoyaltyBalance, useLoyaltyRewards, useRedeemReward, useUndoRedemption } from "@/hooks/useLoyalty";
import { PAYMENT_KIND_LABEL } from "@/lib/finance";
import { money, num } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { fmt } from "@/lib/tz";
import type { LoyaltyReward, OrderItem, OrderItemKind } from "@/lib/types";

const KIND_ICON: Record<OrderItemKind, typeof Scissors> = { servico: Scissors, produto: ShoppingBag, pacote: Package };
const parse = (v: string) => Number(v.replace(",", "."));
/** Valor para campo de texto no formato da tela: 120,00 */
const brl = (v: number) => v.toFixed(2).replace(".", ",");

/** Linha editável enquanto a comanda está aberta (preço "a partir de", quantidade, desconto). */
function ItemRow({ item, proName, editable, reward, points }: {
  item: OrderItem;
  proName: string | null;
  editable: boolean;
  /** Prêmio de fidelidade para este serviço, quando existe. */
  reward?: LoyaltyReward;
  /** Saldo de pontos da cliente (null = sem cliente ou programa desligado). */
  points: number | null;
}) {
  const update = useUpdateOrderItem();
  const remove = useRemoveOrderItem();
  const redeem = useRedeemReward();
  const undo = useUndoRedemption();
  const [qty, setQty] = useState(String(item.quantity));
  const [price, setPrice] = useState(String(item.unit_price));
  const [disc, setDisc] = useState(String(item.discount_amount));
  const Icon = KIND_ICON[item.kind];
  const fromPackage = Boolean(item.client_package_balance_id);
  const fromPoints = Boolean(item.loyalty_reward_id);
  const canRedeem = editable && !fromPackage && !fromPoints && reward && points !== null && Number(item.quantity) === 1;

  useEffect(() => {
    setQty(String(Number(item.quantity)));
    setPrice(brl(Number(item.unit_price)));
    setDisc(brl(Number(item.discount_amount)));
  }, [item.quantity, item.unit_price, item.discount_amount]);

  const save = (patch: Partial<OrderItem>) =>
    update.mutate({ id: item.id, ...patch }, { onError: (err) => toast.error(errorMessage(err)) });

  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted"><Icon className="h-4 w-4 text-foreground/70" /></span>
        <div className="min-w-0">
          <div className="truncate font-medium">{item.description}</div>
          <div className="text-xs text-muted-foreground">
            {proName ?? (item.kind === "pacote" ? "Pacote de sessões" : "Sem profissional")}
            {fromPackage && " · sessão do pacote"}
            {fromPoints && " · pago com pontos"}
          </div>
          {canRedeem && (
            <button type="button" disabled={points! < reward!.points_cost || redeem.isPending}
              title={points! < reward!.points_cost ? `A cliente tem ${num(points)} pontos` : undefined}
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-copper hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
              onClick={() => redeem.mutate({ itemId: item.id, rewardId: reward!.id }, {
                onSuccess: () => toast.success(`${num(reward!.points_cost)} pontos usados`),
                onError: (err) => toast.error(errorMessage(err)),
              })}>
              <Coins className="h-3.5 w-3.5" /> Resgatar com {num(reward!.points_cost)} pontos
            </button>
          )}
          {fromPoints && editable && (
            <button type="button" disabled={undo.isPending}
              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => undo.mutate(item.id, { onSuccess: () => toast.success("Resgate desfeito, os pontos voltaram"), onError: (err) => toast.error(errorMessage(err)) })}>
              <Undo2 className="h-3.5 w-3.5" /> Desfazer resgate
            </button>
          )}
        </div>
      </div>
      {editable && !fromPackage && !fromPoints ? (
        <div className="flex items-end gap-2 pl-11 sm:pl-0">
          {item.kind !== "pacote" && (
            <div className="w-16">
              <Label className="text-[10px] text-muted-foreground" htmlFor={`q-${item.id}`}>Qtd.</Label>
              <Input id={`q-${item.id}`} className="h-8" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)}
                onBlur={() => parse(qty) !== Number(item.quantity) && parse(qty) > 0 && save({ quantity: parse(qty) })} />
            </div>
          )}
          <div className="w-24">
            <Label className="text-[10px] text-muted-foreground" htmlFor={`p-${item.id}`}>Preço</Label>
            <Input id={`p-${item.id}`} className="h-8" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
              onBlur={() => parse(price) !== Number(item.unit_price) && parse(price) >= 0 && save({ unit_price: parse(price) })} />
          </div>
          <div className="w-20">
            <Label className="text-[10px] text-muted-foreground" htmlFor={`d-${item.id}`}>Desconto</Label>
            <Input id={`d-${item.id}`} className="h-8" inputMode="decimal" value={disc} onChange={(e) => setDisc(e.target.value)}
              onBlur={() => parse(disc) !== Number(item.discount_amount) && parse(disc) >= 0 && save({ discount_amount: parse(disc) })} />
          </div>
          <div className="w-24 pb-1.5 text-right font-medium">{money(Number(item.total))}</div>
          <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remover item"
            onClick={() => remove.mutate(item.id, { onError: (err) => toast.error(errorMessage(err)) })}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-4 pl-11 text-sm sm:pl-0">
          <span className="text-muted-foreground">{Number(item.quantity) !== 1 && `${Number(item.quantity)} × `}{money(Number(item.unit_price))}</span>
          {Number(item.discount_amount) > 0 && <span className="text-xs text-muted-foreground">− {money(Number(item.discount_amount))}</span>}
          <span className="w-24 text-right font-medium">{money(Number(item.total))}</span>
          {editable && !fromPoints && (
            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Remover item"
              onClick={() => remove.mutate(item.id, { onError: (err) => toast.error(errorMessage(err)) })}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ComandaDetalhe() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const { can } = usePermissions();
  const { data: o, isLoading } = useOrder(id);
  const { data: pros = [] } = useProfessionals();
  const { data: methods = [] } = usePaymentMethods();
  const updateOrder = useUpdateOrder();
  const cancel = useCancelOrder();
  const loyaltyOn = Boolean(salon!.loyalty_enabled || salon!.referral_enabled);
  const { data: balance } = useLoyaltyBalance(loyaltyOn ? o?.client_id : null);
  const { data: rewards = [] } = useLoyaltyRewards();

  const [adding, setAdding] = useState<OrderItemKind | null>(null);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [discount, setDiscount] = useState("");
  const [discountReason, setDiscountReason] = useState("");

  useEffect(() => {
    if (o) {
      setDiscount(Number(o.discount_amount) ? brl(Number(o.discount_amount)) : "");
      setDiscountReason(o.discount_reason ?? "");
    }
  }, [o?.discount_amount, o?.discount_reason]); // eslint-disable-line react-hooks/exhaustive-deps

  const reserved = useMemo(() => {
    const r: Record<string, number> = {};
    for (const i of o?.items ?? []) if (i.client_package_balance_id) r[i.client_package_balance_id] = (r[i.client_package_balance_id] ?? 0) + Number(i.quantity);
    return r;
  }, [o?.items]);

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (!o) return <p className="text-sm text-muted-foreground">Comanda não encontrada.</p>;

  const isOpen = o.status === "aberta";
  const canCancel = isOpen || (o.status === "fechada" && can("comandas.cancelar_fechada"));
  const proName = (pid: string | null) => pros.find((p) => p.id === pid)?.name ?? null;
  const methodName = (mid: string) => methods.find((m) => m.id === mid)?.name;

  const saveDiscount = () => {
    const v = discount.trim() ? parse(discount) : 0;
    if (Number.isNaN(v) || v < 0) return toast.error("Desconto inválido");
    if (v > Number(o.subtotal)) return toast.error("O desconto passa do total");
    updateOrder.mutate({ id: o.id, discount_amount: v, discount_reason: discountReason.trim() || null }, {
      onSuccess: () => toast.success("Desconto aplicado"),
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const doCancel = async () => {
    if (!reason.trim()) return toast.error("Informe o motivo");
    try {
      await cancel.mutateAsync({ id: o.id, reason: reason.trim() });
      toast.success("Comanda cancelada");
      setCancelling(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <button onClick={() => navigate("/comandas")} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Comandas
      </button>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="label-caps">Comanda #{o.number}</span>
            <OrderStatusBadge status={o.status} />
          </div>
          <h1 className="mt-2 font-display text-3xl font-light">
            {o.client ? <Link to={`/clientes/${o.client.id}`} className="hover:underline">{o.client.name}</Link> : "Venda avulsa"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aberta {fmt(o.opened_at, "dd/MM 'às' HH:mm", tz)}
            {o.closed_at && ` · paga ${fmt(o.closed_at, "dd/MM 'às' HH:mm", tz)}`}
            {o.cancelled_at && ` · cancelada ${fmt(o.cancelled_at, "dd/MM 'às' HH:mm", tz)}`}
          </p>
          {o.appointment_id && (
            <Link to={`/agenda?agendamento=${o.appointment_id}`} className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
              <CalendarDays className="h-3.5 w-3.5" /> Ver agendamento
            </Link>
          )}
        </div>
        {isOpen && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAdding("servico")}><Scissors className="mr-1 h-4 w-4" /> Serviço</Button>
            <Button variant="outline" onClick={() => setAdding("produto")}><ShoppingBag className="mr-1 h-4 w-4" /> Produto</Button>
            <Button variant="outline" onClick={() => (o.client_id ? setAdding("pacote") : toast.error("Escolha a cliente para vender pacote"))}>
              <Gift className="mr-1 h-4 w-4" /> Pacote
            </Button>
          </div>
        )}
      </div>

      {isOpen && !o.client_id && (
        <SectionCard title="Cliente" hint="Opcional em venda de balcão. Obrigatória para vender pacote." className="mb-6">
          <ClientPicker value={null} onChange={(c) => updateOrder.mutate({ id: o.id, client_id: c.id }, { onError: (err) => toast.error(errorMessage(err)) })} />
        </SectionCard>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <SectionCard title="Itens" bodyClassName="pt-1">
          {o.items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Nada lançado ainda.
              {isOpen && <div className="mt-3"><Button size="sm" onClick={() => setAdding("servico")}><Plus className="mr-1 h-4 w-4" /> Lançar serviço</Button></div>}
            </div>
          ) : (
            o.items.map((i) => (
              <ItemRow key={i.id} item={i} proName={proName(i.professional_id)} editable={isOpen}
                reward={salon!.loyalty_enabled && i.kind === "servico" ? rewards.find((r) => r.active && r.service_id === i.service_id) : undefined}
                points={salon!.loyalty_enabled && o.client_id && balance ? balance.points : null} />
            ))
          )}
        </SectionCard>

        <div className="space-y-4">
          <SectionCard>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(Number(o.subtotal))}</span></div>
              {isOpen ? (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="disc" className="flex-1 text-muted-foreground">Desconto (R$)</Label>
                    <Input id="disc" className="h-8 w-24" inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />
                  </div>
                  <Input className="h-8" value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="Motivo (ex.: aniversário)" />
                  {(parse(discount || "0") !== Number(o.discount_amount) || (discountReason || "") !== (o.discount_reason ?? "")) && (
                    <Button size="sm" variant="outline" className="w-full" onClick={saveDiscount}>Aplicar desconto</Button>
                  )}
                </div>
              ) : Number(o.discount_amount) > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Desconto{o.discount_reason && ` · ${o.discount_reason}`}</span><span>− {money(Number(o.discount_amount))}</span></div>
              )}
              <div className="flex items-baseline justify-between border-t border-border pt-3">
                <span className="font-medium">Total</span>
                <span className="font-display text-3xl font-light">{money(Number(o.total))}</span>
              </div>
            </div>
            {isOpen && (
              <Button className="mt-4 w-full" size="lg" disabled={o.items.length === 0} onClick={() => setPaying(true)}>
                {Number(o.total) === 0 ? "Fechar comanda" : "Receber"}
              </Button>
            )}
          </SectionCard>

          {loyaltyOn && o.client_id && balance && (
            <SectionCard>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 text-muted-foreground"><Coins className="h-4 w-4 text-copper" />Fidelidade</span>
                <span className="text-right">
                  {salon!.loyalty_enabled && <span className="block font-semibold tabular-nums">{num(balance.points)} pontos</span>}
                  {Number(balance.credit) > 0 && <span className="block text-xs text-muted-foreground">{money(Number(balance.credit))} de crédito de indicação</span>}
                </span>
              </div>
            </SectionCard>
          )}

          {o.payments.length > 0 && (
            <SectionCard title="Pagamentos">
              <div className="space-y-2 text-sm">
                {o.payments.map((p) => (
                  <div key={p.id} className="flex justify-between gap-2">
                    <span>
                      {methodName(p.payment_method_id) ?? PAYMENT_KIND_LABEL[p.kind]}
                      {p.installments > 1 && ` ${p.installments}x`}
                      {p.refunded_at && <span className="ml-1 text-xs text-destructive">estornado</span>}
                    </span>
                    <span className={p.refunded_at ? "line-through text-muted-foreground" : ""}>{money(Number(p.amount))}</span>
                  </div>
                ))}
                {Number(o.fee_total) > 0 && (
                  <div className="flex justify-between text-xs text-muted-foreground"><span>Taxas das maquininhas</span><span>{money(Number(o.fee_total))}</span></div>
                )}
              </div>
            </SectionCard>
          )}

          {o.cancel_reason && <p className="text-sm text-muted-foreground">Motivo do cancelamento: {o.cancel_reason}</p>}
          {canCancel && (
            <Button variant="ghost" className="w-full text-destructive" onClick={() => setCancelling(true)}><X className="mr-1 h-4 w-4" /> Cancelar comanda</Button>
          )}
        </div>
      </div>

      {adding && (
        <AddItemDialog open={Boolean(adding)} onOpenChange={(v) => !v && setAdding(null)} orderId={o.id} clientId={o.client_id}
          kind={adding} reservedBalances={reserved} />
      )}
      <PaymentDialog open={paying} onOpenChange={setPaying} orderId={o.id} clientId={o.client_id} total={Number(o.total)} onPaid={() => undefined} />

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="font-display font-medium">Cancelar comanda #{o.number}</DialogTitle></DialogHeader>
          {o.status === "fechada" && (
            <p className="text-sm text-muted-foreground">
              A comanda já foi paga. Cancelar devolve os produtos ao estoque, desfaz as comissões e as sessões de pacote,
              e registra a saída do dinheiro recebido em espécie no caixa aberto. Pix e cartão você devolve pela maquininha ou banco.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="cancel-reason">Motivo</Label>
            <Textarea id="cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCancelling(false)}>Voltar</Button>
            <Button variant="destructive" onClick={doCancel} disabled={cancel.isPending}>Cancelar comanda</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
