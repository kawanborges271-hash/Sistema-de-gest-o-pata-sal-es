import { useState } from "react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/common/KpiCard";
import { SectionCard } from "@/components/common/SectionCard";
import { AdjustDialog } from "@/components/fidelidade/AdjustDialog";
import { LoyaltyLedgerList } from "@/components/fidelidade/LoyaltyLedgerList";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useLoyaltyBalance, useLoyaltyLedger } from "@/hooks/useLoyalty";
import { money, num } from "@/lib/format";

/** Saldo e extrato de pontos e crédito de indicação da cliente. */
export function ClientLoyaltyTab({ client }: { client: { id: string; name: string; phone: string | null } }) {
  const { salon } = useAuth();
  const { can } = usePermissions();
  const { data: balance } = useLoyaltyBalance(client.id);
  const { data: ledger = [] } = useLoyaltyLedger(client.id);
  const [adjusting, setAdjusting] = useState(false);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <KpiCard highlight label="Pontos" value={num(balance?.points ?? 0)}
          formula={salon!.loyalty_enabled ? `${num(Number(salon!.loyalty_points_per_real))} por R$ 1 pago` : "Programa de pontos desligado"} />
        <KpiCard label="Crédito de indicação" value={money(Number(balance?.credit ?? 0))} formula="Usa-se como forma de pagamento na comanda" />
      </div>
      <SectionCard title="Extrato" bodyClassName="p-0"
        actions={can("fidelidade.editar") && <Button size="sm" variant="outline" onClick={() => setAdjusting(true)}>Ajuste manual</Button>}>
        <LoyaltyLedgerList rows={ledger} />
      </SectionCard>
      <AdjustDialog open={adjusting} onOpenChange={setAdjusting} client={client} />
    </div>
  );
}
