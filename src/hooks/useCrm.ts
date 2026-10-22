import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Lead, LeadStage, LeadStageHistory, WhatsappMessage } from "@/lib/types";

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

/** Leads ativos (não arquivados). Perdidos e base fria entram para as colunas do funil. */
export function useLeads() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["leads", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<Lead[]>(
        supabase.from("leads").select("*").eq("salon_id", salonId!).is("archived_at", null)
          .order("last_message_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1000),
      ),
  });
}

export function useLeadHistory(leadId: string | null) {
  return useQuery({
    queryKey: ["lead-history", leadId],
    enabled: Boolean(leadId),
    queryFn: () =>
      unwrap<LeadStageHistory[]>(
        supabase.from("lead_stage_history").select("*").eq("lead_id", leadId!).order("changed_at", { ascending: false }),
      ),
  });
}

/** Leads que entraram nos últimos N dias (para a taxa de conversão) */
export function useLeadsCreatedSince(sinceIso: string) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["leads", salonId, "since", sinceIso],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<Pick<Lead, "id" | "stage" | "converted_at" | "created_at">[]>(
        supabase.from("leads").select("id, stage, converted_at, created_at").eq("salon_id", salonId!).gte("created_at", sinceIso),
      ),
  });
}

export type LeadInput = Partial<Pick<Lead, "name" | "phone" | "origin" | "interest" | "notes" | "next_follow_up_at" | "stage" | "lost_reason">>;

export function useSaveLead() {
  const qc = useQueryClient();
  const { salon, user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...v }: LeadInput & { id?: string }) => {
      if (id) {
        const { error } = await supabase.from("leads").update(v).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await supabase.from("leads")
        .insert({ ...v, salon_id: salon!.id, created_by: user!.id }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["leads"] }), qc.invalidateQueries({ queryKey: ["lead-history"] })]),
  });
}

/** Mover de etapa. "Perdido" exige motivo (o banco também exige). */
export function useMoveLead() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async ({ id, stage, lostReason }: { id: string; stage: LeadStage; lostReason?: string }) => {
      const { error } = await supabase.from("leads").update({ stage, lost_reason: stage === "perdido" ? lostReason : null }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["leads", salonId] });
      const prev = qc.getQueryData<Lead[]>(["leads", salonId]);
      qc.setQueryData<Lead[]>(["leads", salonId], (old) => old?.map((l) => (l.id === id ? { ...l, stage, stage_changed_at: new Date().toISOString() } : l)));
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(["leads", salonId], ctx.prev),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ["leads"] }), qc.invalidateQueries({ queryKey: ["lead-history"] })]),
  });
}

export function useArchiveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("leads").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("convert_lead", { p_lead_id: id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["leads"] }), qc.invalidateQueries({ queryKey: ["clients"] })]),
  });
}

/** Conversa do WhatsApp com um telefone (o banco já guarda normalizado) */
export function useConversation(phone: string | null | undefined, ids?: { leadId?: string | null; clientId?: string | null }) {
  const salonId = useAuth().salon?.id;
  const leadId = ids?.leadId ?? null;
  const clientId = ids?.clientId ?? null;
  return useQuery({
    queryKey: ["conversation", salonId, phone, leadId, clientId],
    enabled: Boolean(salonId && (phone || leadId || clientId)),
    refetchInterval: 30_000,
    queryFn: async () => {
      const ors = [phone && `phone.eq.${phone}`, leadId && `lead_id.eq.${leadId}`, clientId && `client_id.eq.${clientId}`].filter(Boolean).join(",");
      const rows = await unwrap<WhatsappMessage[]>(
        supabase.from("whatsapp_messages").select("id, direction, phone, client_id, lead_id, body, sender_name, created_at")
          .eq("salon_id", salonId!).or(ors).order("created_at", { ascending: false }).limit(100),
      );
      return rows.reverse();
    },
  });
}

export function useSendWhatsapp() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async (v: { phone: string; body: string; clientId?: string | null; leadId?: string | null }) => {
      const { data, error } = await supabase.rpc("send_whatsapp_message", {
        p_salon_id: salonId, p_phone: v.phone, p_body: v.body, p_client_id: v.clientId ?? null, p_lead_id: v.leadId ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => Promise.all([
      qc.invalidateQueries({ queryKey: ["queue"] }),
      qc.invalidateQueries({ queryKey: ["leads"] }),
      qc.invalidateQueries({ queryKey: ["pending-to"] }),
    ]),
  });
}

/** Mensagens que ainda vão sair para um telefone (aparecem na conversa como "na fila") */
export function usePendingTo(phone: string | null | undefined) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["pending-to", salonId, phone],
    enabled: Boolean(salonId && phone),
    refetchInterval: 30_000,
    queryFn: () =>
      unwrap<{ id: string; body: string; created_at: string; status: string }[]>(
        supabase.from("message_queue").select("id, body, created_at, status").eq("salon_id", salonId!).eq("phone", phone!)
          .in("status", ["pendente", "enviando"]).order("created_at"),
      ),
  });
}
