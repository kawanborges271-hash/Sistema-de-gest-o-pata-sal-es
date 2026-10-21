import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  Professional, ProfessionalHour, ProfessionalService, ScheduleBlock, Service, ServiceCategory,
} from "@/lib/types";

function useSalonId() {
  return useAuth().salon?.id;
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

export function useCategories() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["categories", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<ServiceCategory[]>(
        supabase.from("service_categories").select("*").eq("salon_id", salonId!).order("sort_order").order("name"),
      ),
  });
}

export function useServices() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["services", salonId],
    enabled: Boolean(salonId),
    queryFn: () => unwrap<Service[]>(supabase.from("services").select("*").eq("salon_id", salonId!).order("name")),
  });
}

export function useProfessionals() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["professionals", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<Professional[]>(
        supabase.from("professionals").select("*").eq("salon_id", salonId!).order("sort_order").order("name"),
      ),
  });
}

export function useProfessionalServices() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["professional_services", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<ProfessionalService[]>(supabase.from("professional_services").select("*").eq("salon_id", salonId!)),
  });
}

export function useProfessionalHours() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["professional_hours", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<ProfessionalHour[]>(
        supabase.from("professional_hours").select("*").eq("salon_id", salonId!).order("weekday").order("start_time"),
      ),
  });
}

export function useBlocks(fromIso: string, toIso: string) {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["blocks", salonId, fromIso, toIso],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<ScheduleBlock[]>(
        supabase.from("schedule_blocks").select("*").eq("salon_id", salonId!).lt("starts_at", toIso).gt("ends_at", fromIso),
      ),
  });
}

/** Invalida tudo que depende do catálogo. */
export function useInvalidateCatalog() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ["categories", "services", "professionals", "professional_services", "professional_hours", "blocks"].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export function useSaveService() {
  const salonId = useSalonId();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async (s: Partial<Service> & { id?: string }) => {
      const payload = { ...s, salon_id: salonId };
      const q = s.id
        ? supabase.from("services").update(payload).eq("id", s.id)
        : supabase.from("services").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useSaveCategory() {
  const salonId = useSalonId();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("service_categories")
        .insert({ salon_id: salonId, name: name.trim() })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: invalidate,
  });
}

export type ProfessionalForm = Partial<Professional> & {
  services: { service_id: string; price: number | null; duration_minutes: number | null; commission_pct: number | null }[];
  hours: { weekday: number; start_time: string; end_time: string }[];
};

/** Salva profissional + serviços + jornada (substitui as listas). */
export function useSaveProfessional() {
  const salonId = useSalonId();
  const invalidate = useInvalidateCatalog();
  return useMutation({
    mutationFn: async ({ services, hours, ...p }: ProfessionalForm) => {
      let id = p.id;
      const payload = { ...p, salon_id: salonId };
      if (id) {
        const { error } = await supabase.from("professionals").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("professionals").insert(payload).select("id").single();
        if (error) throw error;
        id = data.id as string;
      }
      const del1 = await supabase.from("professional_services").delete().eq("professional_id", id);
      if (del1.error) throw del1.error;
      if (services.length) {
        const { error } = await supabase
          .from("professional_services")
          .insert(services.map((s) => ({ ...s, salon_id: salonId, professional_id: id })));
        if (error) throw error;
      }
      const del2 = await supabase.from("professional_hours").delete().eq("professional_id", id);
      if (del2.error) throw del2.error;
      if (hours.length) {
        const { error } = await supabase
          .from("professional_hours")
          .insert(hours.map((h) => ({ ...h, salon_id: salonId, professional_id: id })));
        if (error) throw error;
      }
      return id;
    },
    onSuccess: invalidate,
  });
}
