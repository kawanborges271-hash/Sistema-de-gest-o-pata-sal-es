import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Coins, Gift, HandHeart, Plus, Users } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { KpiCard } from "@/components/common/KpiCard";
import { LoyaltyLedgerList } from "@/components/fidelidade/LoyaltyLedgerList";
import { AdjustDialog } from "@/components/fidelidade/AdjustDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useServices } from "@/hooks/useCatalog";
import { useLoyaltyLedger, useLoyaltyRanking, useLoyaltyRewards, useLoyaltySummary, useSaveReward } from "@/hooks/useLoyalty";
import { money, num } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import type { LoyaltyReward } from "@/lib/types";

export default function Fidelidade() {
  const { salon } = useAuth();
  const { can } = usePermissions();
  const canEdit = can("fidelidade.editar");
  const { data: summary } = useLoyaltySummary();
  const { data: rewards = [] } = useLoyaltyRewards();
  const { data: ranking = [] } = useLoyaltyRanking();
  const { data: ledger = [] } = useLoyaltyLedger();
  const [reward, setReward] = useState<Partial<LoyaltyReward> | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [filter, setFilter] = useState("");
  const shown = ranking.filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <div>
      <PageHeader
        eyebrow="Vendas · Fidelidade"
        title="Pontos que trazem a cliente de volta"
        subtitle={salon!.loyalty_enabled
          ? `Cada R$ 1 pago vale ${num(Number(salon!.loyalty_points_per_real))} ${Number(salon!.loyalty_points_per_real) === 1 ? "ponto" : "pontos"}. Os pontos viram serviços; quem indica ganha crédito.`
          : "O programa está desligado. Ligue abaixo para as comandas pagas começarem a gerar pontos."}
        actions={canEdit && <Button variant="outline" onClick={() => setAdjusting(true)}>Ajuste manual</Button>}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard highlight label="Pontos em aberto" icon={Coins} value={num(summary?.points_outstanding ?? null)}
          formula={`Saldo somado de ${num(summary?.clients_with_points ?? null)} clientes`} />
        <KpiCard label="Pontos dados em 30 dias" icon={Gift} value={num(summary?.points_30d ?? null)} formula="Pontos de compras nos últimos 30 dias" />
        <KpiCard label="Resgates em 30 dias" icon={HandHeart} value={num(summary?.redeemed_30d ?? null)} formula="Serviços pagos com pontos, sem os desfeitos" />
        <KpiCard label="Indicações" icon={Users} value={`${num(summary?.referrals_converted ?? null)} de ${num(summary?.referrals_total ?? null)}`}
          formula={`Indicadas que já pagaram · ${money(summary?.credit_outstanding ?? null)} de crédito em aberto`} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {canEdit && <SettingsCard />}

        <SectionCard title="Prêmios" hint="Serviços que podem ser pagos com pontos, direto na comanda."
          className={canEdit ? "xl:col-span-2" : "xl:col-span-3"}
          actions={canEdit && <Button size="sm" variant="outline" onClick={() => setReward({ active: true, points_cost: 500 })}><Plus className="mr-1 h-4 w-4" />Prêmio</Button>}
          bodyClassName="p-0">
          {rewards.length === 0 && <p className="p-5 text-sm text-muted-foreground">Nenhum prêmio ainda. Escolha um serviço e quantos pontos ele custa.</p>}
          <ul>
            {rewards.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-t border-border px-5 py-3 text-sm first:border-0">
                <Gift className="h-4 w-4 text-copper" />
                <span className="min-w-0 flex-1 truncate font-medium">{r.service?.name}</span>
                <span className="text-xs text-muted-foreground">vale {money(r.service?.price ?? null)}</span>
                <span className="w-24 text-right font-semibold tabular-nums">{num(r.points_cost)} pts</span>
                {!r.active && <span className="text-xs text-muted-foreground">pausado</span>}
                {canEdit && <Button variant="ghost" size="sm" onClick={() => setReward(r)}>Editar</Button>}
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SectionCard title="Saldos das clientes" hint="Quem tem pontos ou crédito de indicação" bodyClassName="p-0"
          actions={<Input placeholder="Buscar" aria-label="Buscar cliente" className="h-8 w-40" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
          <div className="max-h-[28rem] overflow-y-auto">
            {shown.length === 0 && <p className="p-5 text-sm text-muted-foreground">Ninguém com saldo.</p>}
            {shown.map((b) => (
              <div key={b.client_id} className="flex items-center gap-3 border-t border-border px-5 py-2.5 text-sm first:border-0">
                <Link to={`/clientes/${b.client_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{b.name}</Link>
                <span className="w-24 text-right tabular-nums">{num(b.points)} pts</span>
                <span className="w-24 text-right text-xs tabular-nums text-muted-foreground">{Number(b.credit) > 0 ? money(Number(b.credit)) : ""}</span>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Últimos movimentos" hint="Nada é apagado: estornos e ajustes entram como novo movimento." bodyClassName="p-0">
          <div className="max-h-[28rem] overflow-y-auto"><LoyaltyLedgerList rows={ledger} showClient /></div>
        </SectionCard>
      </div>

      <RewardDialog value={reward} onClose={() => setReward(null)} />
      <AdjustDialog open={adjusting} onOpenChange={setAdjusting} />
    </div>
  );
}

function SettingsCard() {
  const { salon, refresh } = useAuth();
  const from = () => ({
    loyalty_enabled: salon!.loyalty_enabled,
    loyalty_points_per_real: String(salon!.loyalty_points_per_real),
    referral_enabled: salon!.referral_enabled,
    referral_credit: String(salon!.referral_credit),
  });
  const [form, setForm] = useState(from);
  const [saving, setSaving] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(from()), [salon]);

  const submit = async () => {
    const ppr = Number(form.loyalty_points_per_real.replace(",", "."));
    const credit = Number(form.referral_credit.replace(",", "."));
    if (!(ppr > 0 && ppr <= 100)) return toast.error("Pontos por real entre 0,01 e 100");
    if (!(credit >= 0)) return toast.error("Crédito inválido");
    setSaving(true);
    const { error } = await supabase.from("salons").update({
      loyalty_enabled: form.loyalty_enabled, loyalty_points_per_real: ppr,
      referral_enabled: form.referral_enabled, referral_credit: credit,
    }).eq("id", salon!.id);
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    toast.success("Programa salvo");
  };

  return (
    <SectionCard title="Regras do programa">
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-3 text-sm font-medium">
          Pontos por compra
          <Switch checked={form.loyalty_enabled} onCheckedChange={(v) => setForm({ ...form, loyalty_enabled: v })} />
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="ppr" className="text-xs">Pontos por R$ 1 pago</Label>
          <Input id="ppr" inputMode="decimal" value={form.loyalty_points_per_real} disabled={!form.loyalty_enabled}
            onChange={(e) => setForm({ ...form, loyalty_points_per_real: e.target.value })} />
          <p className="text-xs text-muted-foreground">Conta o que foi pago, sem a parte paga com crédito de indicação.</p>
        </div>
        <label className="flex items-center justify-between gap-3 border-t border-border pt-4 text-sm font-medium">
          Programa de indicação
          <Switch checked={form.referral_enabled} onCheckedChange={(v) => setForm({ ...form, referral_enabled: v })} />
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="refc" className="text-xs">Crédito para quem indica (R$)</Label>
          <Input id="refc" inputMode="decimal" value={form.referral_credit} disabled={!form.referral_enabled}
            onChange={(e) => setForm({ ...form, referral_credit: e.target.value })} />
          <p className="text-xs text-muted-foreground">Entra quando a indicada paga a primeira comanda. Usa-se como forma de pagamento “Crédito de indicação”.</p>
        </div>
        <Button className="w-full" onClick={submit} disabled={saving}>Salvar regras</Button>
      </div>
    </SectionCard>
  );
}

function RewardDialog({ value, onClose }: { value: Partial<LoyaltyReward> | null; onClose: () => void }) {
  const { data: services = [] } = useServices();
  const { data: rewards = [] } = useLoyaltyRewards();
  const save = useSaveReward();
  const [form, setForm] = useState({ service_id: "", points_cost: "500", active: true });
  useEffect(() => {
    if (value) setForm({ service_id: value.service_id ?? "", points_cost: String(value.points_cost ?? 500), active: value.active ?? true });
  }, [value]);
  const taken = new Set(rewards.filter((r) => r.id !== value?.id).map((r) => r.service_id));

  const submit = async () => {
    const cost = Math.round(Number(form.points_cost));
    if (!form.service_id) return toast.error("Escolha o serviço");
    if (!(cost > 0)) return toast.error("Informe quantos pontos custa");
    try {
      await save.mutateAsync({ id: value?.id, service_id: form.service_id, points_cost: cost, active: form.active });
      toast.success("Prêmio salvo");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={value !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="font-display font-medium">{value?.id ? "Editar prêmio" : "Novo prêmio"}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Serviço</Label>
            <Select value={form.service_id} onValueChange={(v) => setForm({ ...form, service_id: v })} disabled={Boolean(value?.id)}>
              <SelectTrigger aria-label="Serviço"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {services.filter((s) => s.active && !taken.has(s.id)).map((s) => <SelectItem key={s.id} value={s.id}>{s.name} · {money(Number(s.price))}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cost" className="text-xs">Custa (pontos)</Label>
            <Input id="cost" inputMode="numeric" value={form.points_cost} onChange={(e) => setForm({ ...form, points_cost: e.target.value })} />
          </div>
          <label className="flex items-center justify-between text-sm">Disponível para resgate
            <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
