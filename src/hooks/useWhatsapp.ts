import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  Automation, AutomationKind, Campaign, ClientFeedback, OptOut, QueuedMessage, WhatsappIntegrationStatus,
} from "@/lib/types";

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

// ---------------------------------------------------------------------
// Integração (admin)
// ---------------------------------------------------------------------
export function useWhatsappIntegration(enabled = true) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["wa-integration", salonId],
    enabled: Boolean(salonId) && enabled,
    queryFn: async () => {
      const rows = await unwrap<WhatsappIntegrationStatus[]>(supabase.rpc("whatsapp_integration_status", { p_salon_id: salonId }));
      return rows[0] ?? null;
    },
  });
}

export function useSaveWhatsappIntegration() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (v: { instanceId: string; token?: string; clientToken?: string; phone?: string }) => {
      const { error } = await supabase.rpc("save_whatsapp_integration", {
        p_salon_id: salonId, p_instance_id: v.instanceId, p_token: v.token || null, p_client_token: v.clientToken || null,
        p_phone: v.phone || null, p_app_url: window.location.origin,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-integration"] }),
  });
}

export function useSetWhatsappActive() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (active: boolean) => {
      const { error } = await supabase.rpc("set_whatsapp_active", { p_salon_id: salonId, p_active: active });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-integration"] }),
  });
}

export function useRotateWebhookSecret() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("rotate_whatsapp_webhook_secret", { p_salon_id: salonId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-integration"] }),
  });
}

export type ConnectAction = "status" | "qrcode" | "webhook" | "test";
export type ConnectResult = { ok: boolean; status?: string; image?: string; error?: string | null; smartphone_connected?: boolean | null };

/** Ações que conversam com a Z-API (Edge Function whatsapp-connect) */
export function useWhatsappConnect() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (v: { action: ConnectAction; phone?: string }): Promise<ConnectResult> => {
      const { data, error } = await supabase.functions.invoke("whatsapp-connect", { body: { salon_id: salonId, ...v } });
      if (error) {
        // corpo da resposta de erro traz a mensagem amigável
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
        throw new Error(body?.error ?? error.message);
      }
      return data as ConnectResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wa-integration"] }),
  });
}

export function webhookUrlFor(salonId: string, secret: string): string {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";
  return `${base}/functions/v1/whatsapp-webhook?salon=${salonId}&secret=${secret}`;
}

// ---------------------------------------------------------------------
// Automações
// ---------------------------------------------------------------------
export function useAutomations() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["automations", salonId],
    enabled: Boolean(salonId),
    queryFn: () => unwrap<Automation[]>(supabase.from("automations").select("*").eq("salon_id", salonId!)),
  });
}

export function useSaveAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...v }: Partial<Pick<Automation, "enabled" | "template" | "settings">> & { id: string }) => {
      const { data, error } = await supabase.from("automations").update(v).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Só o administrador do salão altera as automações");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["automations"] }),
  });
}

// ---------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------
export type QueueTab = "proximos" | "enviadas" | "nao_enviadas";

export function useQueue(tab: QueueTab, kind?: AutomationKind | "campanha" | "manual" | "all") {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["queue", salonId, tab, kind ?? "all"],
    enabled: Boolean(salonId),
    refetchInterval: 30_000,
    queryFn: () => {
      let q = supabase.from("message_queue")
        .select("*, client:clients(name), lead:leads(name)")
        .eq("salon_id", salonId!);
      if (tab === "proximos") q = q.in("status", ["pendente", "enviando"]).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
      if (tab === "enviadas") q = q.eq("status", "enviada");
      if (tab === "nao_enviadas") q = q.in("status", ["falhou", "cancelada", "ignorada", "expirada"]);
      if (kind && kind !== "all") q = q.eq("kind", kind);
      q = tab === "proximos"
        ? q.order("scheduled_for", { ascending: true })
        : tab === "enviadas" ? q.order("sent_at", { ascending: false }) : q.order("created_at", { ascending: false });
      return unwrap<QueuedMessage[]>(q.limit(100));
    },
  });
}

/** Contadores do topo: enviadas hoje, na fila e falhas em 7 dias */
export function useQueueCounters(todayStartIso: string) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["queue", salonId, "counters", todayStartIso],
    enabled: Boolean(salonId),
    refetchInterval: 30_000,
    queryFn: async () => {
      const head = { count: "exact" as const, head: true };
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const [sent, queued, failed] = await Promise.all([
        supabase.from("message_queue").select("id", head).eq("salon_id", salonId!).eq("status", "enviada").gte("sent_at", todayStartIso),
        supabase.from("message_queue").select("id", head).eq("salon_id", salonId!).in("status", ["pendente", "enviando"])
          .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`),
        supabase.from("message_queue").select("id", head).eq("salon_id", salonId!).eq("status", "falhou").gte("created_at", weekAgo),
      ]);
      for (const r of [sent, queued, failed]) if (r.error) throw r.error;
      return { sentToday: sent.count ?? 0, queued: queued.count ?? 0, failed7d: failed.count ?? 0 };
    },
  });
}

export function useAppointmentMessages(appointmentId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["queue", "appointment", appointmentId],
    enabled: Boolean(appointmentId) && enabled,
    queryFn: () =>
      unwrap<Pick<QueuedMessage, "id" | "kind" | "status" | "sent_at" | "scheduled_for" | "last_error">[]>(
        supabase.from("message_queue").select("id, kind, status, sent_at, scheduled_for, last_error")
          .eq("appointment_id", appointmentId!).order("created_at"),
      ),
  });
}

export function useCancelQueued() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_queued_message", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

export function useRetryQueued() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("retry_queued_message", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["queue"] }),
  });
}

// ---------------------------------------------------------------------
// Campanhas, opt-out e notas
// ---------------------------------------------------------------------
export function useCampaigns() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["campaigns", salonId],
    enabled: Boolean(salonId),
    queryFn: () => unwrap<Campaign[]>(supabase.from("campaigns").select("*").eq("salon_id", salonId!).order("created_at", { ascending: false }).limit(30)),
  });
}

/** Quantas mensagens de cada campanha já saíram */
export function useCampaignProgress(ids: string[]) {
  return useQuery({
    queryKey: ["campaigns", "progress", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const rows = await unwrap<{ campaign_id: string; status: string }[]>(
        supabase.from("message_queue").select("campaign_id, status").in("campaign_id", ids),
      );
      const out: Record<string, { sent: number; pending: number; failed: number }> = {};
      for (const r of rows) {
        const o = (out[r.campaign_id] ??= { sent: 0, pending: 0, failed: 0 });
        if (r.status === "enviada") o.sent++;
        else if (r.status === "pendente" || r.status === "enviando") o.pending++;
        else o.failed++;
      }
      return out;
    },
  });
}

export type AudienceRow = { client_id: string; name: string; phone: string; last_visit_at: string | null; total_spent: number | null };

export function useCampaignAudience(audience: string | null, days = 60) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["campaign-audience", salonId, audience, days],
    enabled: Boolean(salonId && audience),
    queryFn: () => unwrap<AudienceRow[]>(supabase.rpc("campaign_audience", { p_salon_id: salonId, p_audience: audience, p_days: days })),
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (v: { name: string; body: string; clientIds: string[]; audience: string; scheduledFor?: string }) => {
      const { data, error } = await supabase.rpc("create_campaign", {
        p_salon_id: salonId, p_name: v.name, p_body: v.body, p_client_ids: v.clientIds,
        p_audience: v.audience, p_scheduled_for: v.scheduledFor ?? new Date().toISOString(),
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["campaigns"] }), qc.invalidateQueries({ queryKey: ["queue"] })]),
  });
}

export function useOptOuts() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["opt-outs", salonId],
    enabled: Boolean(salonId),
    queryFn: () => unwrap<OptOut[]>(supabase.from("opt_outs").select("*").eq("salon_id", salonId!).order("created_at", { ascending: false })),
  });
}

export function useAddOptOut() {
  const qc = useQueryClient();
  const { salon, user } = useAuth();
  return useMutation({
    mutationFn: async (phone: string) => {
      const { error } = await supabase.from("opt_outs").insert({ salon_id: salon!.id, phone, reason: "manual", created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["opt-outs"] }), qc.invalidateQueries({ queryKey: ["queue"] }), qc.invalidateQueries({ queryKey: ["clients"] })]),
  });
}

export function useRemoveOptOut() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (phone: string) => {
      const { error } = await supabase.from("opt_outs").delete().eq("salon_id", salonId!).eq("phone", phone);
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["opt-outs"] }), qc.invalidateQueries({ queryKey: ["clients"] })]),
  });
}

export function useFeedback() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["feedback", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<ClientFeedback[]>(
        supabase.from("client_feedback").select("*, client:clients(name)").eq("salon_id", salonId!).order("created_at", { ascending: false }).limit(100),
      ),
  });
}
