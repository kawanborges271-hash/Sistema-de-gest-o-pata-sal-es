import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { LoyaltyBalance, LoyaltyMovement, LoyaltyReward, LoyaltySummary } from "@/lib/types";

const invalidate = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all(["loyalty", "order", "orders"].map((k) => qc.invalidateQueries({ queryKey: [k] })));

export function useLoyaltyRewards() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["loyalty", "rewards", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase.from("loyalty_rewards").select("*, service:services(name, price)")
        .eq("salon_id", salonId!).order("points_cost");
      if (error) throw error;
      return (data ?? []) as LoyaltyReward[];
    },
  });
}

export function useSaveReward() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (v: { id?: string; service_id: string; points_cost: number; active: boolean }) => {
      const { error } = v.id
        ? await supabase.from("loyalty_rewards").update({ points_cost: v.points_cost, active: v.active }).eq("id", v.id)
        : await supabase.from("loyalty_rewards").insert({ salon_id: salonId, service_id: v.service_id, points_cost: v.points_cost, active: v.active });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useLoyaltyBalance(clientId: string | null | undefined) {
  return useQuery({
    queryKey: ["loyalty", "balance", clientId],
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase.from("client_loyalty_balance").select("*").eq("client_id", clientId!).maybeSingle();
      if (error) throw error;
      return (data ?? { points: 0, credit: 0 }) as Pick<LoyaltyBalance, "points" | "credit">;
    },
  });
}

export function useLoyaltyRanking() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["loyalty", "ranking", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase.from("client_loyalty_balance").select("*")
        .eq("salon_id", salonId!).or("points.gt.0,credit.gt.0").order("points", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as LoyaltyBalance[];
    },
  });
}

export function useLoyaltyLedger(clientId?: string | null) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["loyalty", "ledger", salonId, clientId ?? "all"],
    enabled: Boolean(salonId),
    queryFn: async () => {
      let q = supabase.from("loyalty_ledger").select("*, client:clients!loyalty_ledger_client_id_fkey(name)").eq("salon_id", salonId!);
      if (clientId) q = q.eq("client_id", clientId);
      const { data, error } = await q.order("created_at", { ascending: false }).limit(clientId ? 100 : 60);
      if (error) throw error;
      return (data ?? []) as LoyaltyMovement[];
    },
  });
}

export function useLoyaltySummary() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["loyalty", "summary", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("loyalty_summary", { p_salon_id: salonId });
      if (error) throw error;
      return data as LoyaltySummary;
    },
  });
}

export function useAdjustLoyalty() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { clientId: string; kind: "pontos" | "credito"; amount: number; note: string }) => {
      const { error } = await supabase.rpc("adjust_loyalty", { p_client_id: v.clientId, p_kind: v.kind, p_amount: v.amount, p_note: v.note });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useRedeemReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { itemId: string; rewardId: string }) => {
      const { error } = await supabase.rpc("redeem_loyalty_reward", { p_order_item_id: v.itemId, p_reward_id: v.rewardId });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}

export function useUndoRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase.rpc("undo_loyalty_redemption", { p_order_item_id: itemId });
      if (error) throw error;
    },
    onSuccess: () => invalidate(qc),
  });
}
