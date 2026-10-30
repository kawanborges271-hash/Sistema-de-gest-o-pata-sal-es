import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { DashboardSummary, IntelAction, IntelReport, MarketingChannel, MarketingRow, ProfessionalPanel, TeamReport } from "@/lib/types";

export function useDashboard(from: string, to: string) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["dashboard", salonId, from, to],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("dashboard_summary", { p_salon_id: salonId, p_from: from, p_to: to });
      if (error) throw error;
      return data as DashboardSummary;
    },
  });
}

export function useMarketingReport(months = 12) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["marketing", salonId, months],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("marketing_report", { p_salon_id: salonId, p_months: months });
      if (error) throw error;
      return (data ?? []) as MarketingRow[];
    },
  });
}

export type MarketingEntryInput = {
  month: string;
  channel: MarketingChannel;
  investment: number;
  leads: number | null;
  appointments: number | null;
  sales: number | null;
  revenue: number | null;
  notes: string | null;
};

export function useSaveMarketingEntries() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (rows: MarketingEntryInput[]) => {
      const { error } = await supabase.from("marketing_entries")
        .upsert(rows.map((r) => ({ ...r, salon_id: salonId })), { onConflict: "salon_id,month,channel" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing"] }),
  });
}

export function useDeleteMarketingMonth() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (month: string) => {
      const { error } = await supabase.from("marketing_entries").delete().eq("salon_id", salonId!).eq("month", month);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["marketing"] }),
  });
}

export function useIntelActions() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["intel-actions", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("intelligence_actions", { p_salon_id: salonId });
      if (error) throw error;
      return (data ?? []) as IntelAction[];
    },
  });
}

export function useIntelReport(days: number) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["intel-report", salonId, days],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("intelligence_report", { p_salon_id: salonId, p_days: days });
      if (error) throw error;
      return data as IntelReport;
    },
  });
}

/** Painel do profissional: o próprio, ou (para o admin) o de quem for escolhido. */
export function useProfessionalPanel(from: string, to: string, professionalId?: string | null) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["professional-panel", salonId, from, to, professionalId ?? null],
    enabled: Boolean(salonId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("professional_panel", {
        p_salon_id: salonId, p_from: from, p_to: to, p_professional_id: professionalId ?? null,
      });
      if (error) throw error;
      return data as ProfessionalPanel;
    },
  });
}

/** Quanto cada pessoa da equipe faturou e quanto isso é do salão (só o admin). */
export function useTeamReport(from: string, to: string) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["team-report", salonId, from, to],
    enabled: Boolean(salonId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("team_report", { p_salon_id: salonId, p_from: from, p_to: to });
      if (error) throw error;
      return data as TeamReport;
    },
  });
}
