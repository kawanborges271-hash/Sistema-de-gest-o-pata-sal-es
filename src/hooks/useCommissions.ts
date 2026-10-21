import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Commission, CommissionPayout } from "@/lib/types";

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

/** Lançamentos de comissão no período (RLS: profissional só recebe os próprios). */
export function useCommissions(fromDay: string, toDay: string, professionalId?: string) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["commissions", salonId, fromDay, toDay, professionalId ?? "all"],
    enabled: Boolean(salonId),
    queryFn: () => {
      let q = supabase.from("commissions").select("*").eq("salon_id", salonId!)
        .gte("competence_date", fromDay).lte("competence_date", toDay);
      if (professionalId) q = q.eq("professional_id", professionalId);
      return unwrap<Commission[]>(q.order("competence_date", { ascending: false }).order("order_number", { ascending: false }));
    },
  });
}

/** Tudo que está pendente (de qualquer data): o que o salão deve hoje. */
export function usePendingCommissions() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["commissions", salonId, "pending"],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<Pick<Commission, "professional_id" | "amount" | "competence_date">[]>(
        supabase.from("commissions").select("professional_id, amount, competence_date").eq("salon_id", salonId!).eq("status", "pendente"),
      ),
  });
}

export function usePayouts() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["commissions", salonId, "payouts"],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<CommissionPayout[]>(
        supabase.from("commission_payouts").select("*").eq("salon_id", salonId!).order("paid_at", { ascending: false }).limit(50),
      ),
  });
}

export function usePayCommissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { professionalId: string; until: string; method?: string; notes?: string; fromCash: boolean }) => {
      const { error } = await supabase.rpc("pay_commissions", {
        p_professional_id: v.professionalId, p_until: v.until, p_method: v.method || null, p_notes: v.notes || null, p_from_cash: v.fromCash,
      });
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["commissions"] }), qc.invalidateQueries({ queryKey: ["cash"] })]),
  });
}
