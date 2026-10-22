import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { BusinessHoursEditor } from "@/components/salao/BusinessHoursEditor";
import { PlanCard } from "@/components/salao/PlanCard";
import { OnlineBookingCard } from "@/components/salao/OnlineBookingCard";
import { PaymentMethodsCard } from "@/components/salao/PaymentMethodsCard";
import { SalonInfoFields, salonInfoFrom, type SalonInfo } from "@/components/salao/SalonInfoFields";
import { WhatsappCard } from "@/components/salao/WhatsappCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { formatPhone, normalizePhone } from "@/lib/format";
import type { BusinessHours, Salon } from "@/lib/types";

export default function Configuracoes() {
  const { salon, refresh } = useAuth();
  const [info, setInfo] = useState<SalonInfo>(salonInfoFrom(salon));
  const [hours, setHours] = useState<BusinessHours>(salon!.business_hours ?? {});
  const [commission, setCommission] = useState({
    commission_base: salon!.commission_base,
    commission_deduct_card_fee: salon!.commission_deduct_card_fee,
    commission_deduct_product_cost: salon!.commission_deduct_product_cost,
  });
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    setInfo({ ...salonInfoFrom(salon), whatsapp: salon?.whatsapp ? formatPhone(salon.whatsapp) : "" });
  }, [salon]);

  const save = async (key: string, patch: Partial<Salon>) => {
    setSaving(key);
    const { error } = await supabase.from("salons").update(patch).eq("id", salon!.id);
    setSaving(null);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    toast.success("Configurações salvas");
  };

  return (
    <div>
      <PageHeader eyebrow="Gestão · Configurações" title="Os dados do seu salão." subtitle="Nome, contato, horário de funcionamento, pagamento, comissão, WhatsApp e o link de agendamento online." />
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Salão" hint={`Endereço do link de agendamento: /agendar/${salon!.slug}`}>
          <SalonInfoFields value={info} onChange={setInfo} />
          <Button className="mt-4" disabled={saving === "info"}
            onClick={() => save("info", { ...info, name: info.name.trim() || salon!.name, whatsapp: info.whatsapp ? normalizePhone(info.whatsapp) : null })}>
            Salvar dados
          </Button>
        </SectionCard>

        <SectionCard title="Horário de funcionamento" hint={`Fuso: ${salon!.timezone}`}>
          <BusinessHoursEditor value={hours} onChange={setHours} />
          <Button className="mt-4" disabled={saving === "hours"} onClick={() => save("hours", { business_hours: hours })}>Salvar horário</Button>
        </SectionCard>

        <SectionCard title="Comissão" hint="Vale para as comandas pagas daqui em diante; o que já foi calculado não muda.">
          <RadioGroup value={commission.commission_base} onValueChange={(v) => setCommission({ ...commission, commission_base: v as Salon["commission_base"] })} className="space-y-2">
            <Label className="flex items-start gap-3 rounded-xl border border-border p-3 font-normal">
              <RadioGroupItem value="bruto" className="mt-0.5" />
              <span><b>Sobre o valor bruto</b><span className="block text-xs text-muted-foreground">Comissão = valor cobrado (já com desconto) × %. Mais simples de explicar para a equipe.</span></span>
            </Label>
            <Label className="flex items-start gap-3 rounded-xl border border-border p-3 font-normal">
              <RadioGroupItem value="liquido" className="mt-0.5" />
              <span><b>Sobre o valor líquido</b><span className="block text-xs text-muted-foreground">Desconta o que você marcar abaixo antes de aplicar o %.</span></span>
            </Label>
          </RadioGroup>
          <div className="mt-3 space-y-2">
            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              Descontar a taxa da maquininha
              <Switch disabled={commission.commission_base === "bruto"} checked={commission.commission_deduct_card_fee} onCheckedChange={(v) => setCommission({ ...commission, commission_deduct_card_fee: v })} />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              Descontar o custo dos produtos usados
              <Switch disabled={commission.commission_base === "bruto"} checked={commission.commission_deduct_product_cost} onCheckedChange={(v) => setCommission({ ...commission, commission_deduct_product_cost: v })} />
            </label>
          </div>
          <Button className="mt-4" disabled={saving === "commission"}
            onClick={() => save("commission", commission.commission_base === "bruto"
              ? { commission_base: "bruto", commission_deduct_card_fee: false, commission_deduct_product_cost: false }
              : commission)}>
            Salvar regra
          </Button>
        </SectionCard>

        <PaymentMethodsCard />
        <WhatsappCard />
        <OnlineBookingCard />
        <PlanCard />
      </div>
    </div>
  );
}
