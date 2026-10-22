import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Appointment, AppointmentOrigin, AppointmentStatus, BlockKind, WaitlistEntry } from "@/lib/types";

const SELECT = "*, client:clients(id, name, phone), items:appointment_items(*)";

/** Agendamentos que começam no intervalo [from, to). */
export function useAppointments(fromIso: string, toIso: string) {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["appointments", salonId, fromIso, toIso],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select(SELECT)
        .eq("salon_id", salonId!)
        .gte("starts_at", fromIso)
        .lt("starts_at", toIso)
        .order("starts_at");
      if (error) throw error;
      return ((data ?? []) as Appointment[]).map((a) => ({
        ...a,
        items: [...(a.items ?? [])].sort((x, y) => x.position - y.position),
      }));
    },
  });
}

export function useAppointment(id: string | null) {
  return useQuery({
    queryKey: ["appointment", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from("appointments").select(SELECT).eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as Appointment | null;
    },
  });
}

function useInvalidateAgenda() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["appointments", "appointment", "client-overview", "client-history", "insight", "waitlist"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export type NewItem = {
  service_id: string;
  professional_id: string;
  starts_at?: string;
  duration_minutes?: number;
  price?: number;
  is_squeeze?: boolean;
};

export function useCreateAppointment() {
  const salonId = useAuth().salon?.id;
  const invalidate = useInvalidateAgenda();
  return useMutation({
    mutationFn: async (input: {
      client_id: string;
      items: NewItem[];
      origin?: AppointmentOrigin;
      notes?: string | null;
      status?: AppointmentStatus;
    }) => {
      const { data, error } = await supabase.rpc("create_appointment", {
        p_salon_id: salonId,
        p_client_id: input.client_id,
        p_items: input.items,
        p_origin: input.origin ?? "recepcao",
        p_notes: input.notes ?? null,
        p_status: input.status ?? "agendado",
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useReschedule() {
  const invalidate = useInvalidateAgenda();
  return useMutation({
    mutationFn: async (input: { id: string; starts_at: string; professional_id?: string | null; squeeze?: boolean }) => {
      const { data, error } = await supabase.rpc("reschedule_appointment", {
        p_appointment_id: input.id,
        p_new_start: input.starts_at,
        p_professional_id: input.professional_id ?? null,
        p_is_squeeze: input.squeeze ?? false,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useSetStatus() {
  const invalidate = useInvalidateAgenda();
  return useMutation({
    mutationFn: async (input: { id: string; status: AppointmentStatus; reason?: string }) => {
      const { error } = await supabase.rpc("set_appointment_status", {
        p_appointment_id: input.id,
        p_status: input.status,
        p_reason: input.reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateAppointmentNotes() {
  const invalidate = useInvalidateAgenda();
  return useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase.from("appointments").update({ notes: notes || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useCreateBlock() {
  const salonId = useAuth().salon?.id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: { professional_id: string | null; kind: BlockKind; reason: string | null; starts_at: string; ends_at: string }) => {
      const { error } = await supabase.from("schedule_blocks").insert({ ...b, salon_id: salonId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocks"] }),
  });
}

export function useDeleteBlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("schedule_blocks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocks"] }),
  });
}

export function useWaitlist() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["waitlist", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waitlist")
        .select("*, client:clients(id, name, phone)")
        .eq("salon_id", salonId!)
        .eq("status", "aguardando")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as WaitlistEntry[];
    },
  });
}

export function useSaveWaitlist() {
  const salonId = useAuth().salon?.id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (w: Partial<WaitlistEntry> & { id?: string }) => {
      const { client, ...rest } = w;
      void client;
      const q = w.id
        ? supabase.from("waitlist").update(rest).eq("id", w.id)
        : supabase.from("waitlist").insert({ ...rest, salon_id: salonId });
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waitlist"] }),
  });
}

export type WaitlistSuggestion = {
  waitlist_id: string;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  service_id: string | null;
  professional_id: string | null;
  period: string;
  notes: string | null;
};

export async function fetchWaitlistSuggestions(appointmentId: string) {
  const { data, error } = await supabase.rpc("waitlist_suggestions", { p_appointment_id: appointmentId });
  if (error) throw error;
  return (data ?? []) as WaitlistSuggestion[];
}
