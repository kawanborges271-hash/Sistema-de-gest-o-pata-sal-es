import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Plan, PlanUsage, PlatformAuditRow, PlatformMember, PlatformOverview, PlatformSalon, PlatformUser, SalonRole } from "@/lib/types";

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

/** Tudo que muda no painel invalida o painel inteiro: são poucas consultas e todas pequenas. */
function useInvalidatePlatform() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["platform"] });
}

export function usePlans() {
  return useQuery({
    queryKey: ["platform", "plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });
}

export function usePlatformOverview() {
  return useQuery({ queryKey: ["platform", "overview"], queryFn: () => rpc<PlatformOverview>("platform_overview") });
}

export function usePlatformSalons() {
  return useQuery({ queryKey: ["platform", "salons"], queryFn: async () => (await rpc<PlatformSalon[]>("platform_salons")) ?? [] });
}

export function usePlatformSalonMembers(salonId: string | null) {
  return useQuery({
    queryKey: ["platform", "members", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => (await rpc<PlatformMember[]>("platform_salon_members", { p_salon_id: salonId })) ?? [],
  });
}

export function usePlatformUserSearch(term: string) {
  const t = term.trim();
  return useQuery({
    queryKey: ["platform", "users", t],
    enabled: t.length >= 2,
    queryFn: async () => (await rpc<PlatformUser[]>("platform_search_users", { p_term: t })) ?? [],
  });
}

export function usePlatformAudit(limit = 80) {
  return useQuery({ queryKey: ["platform", "audit", limit], queryFn: async () => (await rpc<PlatformAuditRow[]>("platform_audit_list", { p_limit: limit })) ?? [] });
}

export function useCreateSalon() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: (v: { name: string; ownerEmail: string; planId: string; timezone: string }) =>
      rpc<{ salon_id: string; owner_user_id: string | null; invitation_token: string | null }>("platform_create_salon", {
        p_name: v.name, p_owner_email: v.ownerEmail, p_plan_id: v.planId, p_timezone: v.timezone,
      }),
    onSuccess: invalidate,
  });
}

export function useSetSuspended() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: (v: { salonId: string; suspended: boolean; reason?: string }) =>
      rpc<void>("platform_set_suspended", { p_salon_id: v.salonId, p_suspended: v.suspended, p_reason: v.reason ?? null }),
    onSuccess: invalidate,
  });
}

export function useSetPlan() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: (v: { salonId: string; planId: string }) => rpc<void>("platform_set_plan", { p_salon_id: v.salonId, p_plan_id: v.planId }),
    onSuccess: invalidate,
  });
}

export function useSavePlan() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: (v: { id: string; name: string; maxProfessionals: number | null; maxMessages: number | null }) =>
      rpc<void>("platform_save_plan", { p_id: v.id, p_name: v.name, p_max_professionals: v.maxProfessionals, p_max_messages_month: v.maxMessages }),
    onSuccess: invalidate,
  });
}

export function useMoveUser() {
  const invalidate = useInvalidatePlatform();
  return useMutation({
    mutationFn: (v: { userId: string; fromSalonId: string | null; toSalonId: string; role: SalonRole }) =>
      rpc<void>("platform_move_user", { p_user_id: v.userId, p_from_salon_id: v.fromSalonId, p_to_salon_id: v.toSalonId, p_role: v.role }),
    onSuccess: invalidate,
  });
}

/** Plano e consumo do salão atual (Configurações do dono). */
export function usePlanUsage() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["plan-usage", salonId],
    enabled: Boolean(salonId),
    queryFn: () => rpc<PlanUsage>("salon_plan_usage", { p_salon_id: salonId }),
  });
}
