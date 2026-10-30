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

// O percentual de comissão de cada profissional não vem nestas colunas: só o
// administrador lê, pela função commission_rates (atualização 020).
const PROFESSIONAL_COLUMNS = "id, salon_id, name, role_title, phone, email, color, user_id, sort_order, active";
const PROFESSIONAL_SERVICE_COLUMNS = "salon_id, professional_id, service_id, price, duration_minutes";

type CommissionRates = {
  professionals: { id: string; default_commission_pct: number }[];
  services: { professional_id: string; service_id: string; commission_pct: number | null }[];
};

async function commissionRates(salonId: string): Promise<CommissionRates> {
  const { data, error } = await supabase.rpc("commission_rates", { p_salon_id: salonId });
  if (!error) return data as CommissionRates;
  // Banco ainda sem a atualização 020: as colunas continuam abertas na tabela
  if ((error as { code?: string }).code === "PGRST202") {
    const [professionals, services] = await Promise.all([
      unwrap<CommissionRates["professionals"]>(supabase.from("professionals").select("id, default_commission_pct").eq("salon_id", salonId)),
      unwrap<CommissionRates["services"]>(supabase.from("professional_services").select("professional_id, service_id, commission_pct").eq("salon_id", salonId)),
    ]);
    return { professionals, services };
  }
  throw error;
}

export function useProfessionals() {
  const salonId = useSalonId();
  const isAdmin = useAuth().role === "admin";
  return useQuery({
    queryKey: ["professionals", salonId, isAdmin],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const [list, rates] = await Promise.all([
        unwrap<Professional[]>(
          supabase.from("professionals").select(PROFESSIONAL_COLUMNS).eq("salon_id", salonId!).order("sort_order").order("name"),
        ),
        isAdmin ? commissionRates(salonId!) : null,
      ]);
      if (!rates) return list;
      const pct = new Map(rates.professionals.map((r) => [r.id, Number(r.default_commission_pct)]));
      return list.map((p) => ({ ...p, default_commission_pct: pct.get(p.id) ?? 0 }));
    },
  });
}

export function useProfessionalServices() {
  const salonId = useSalonId();
  const isAdmin = useAuth().role === "admin";
  return useQuery({
    queryKey: ["professional_services", salonId, isAdmin],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const [list, rates] = await Promise.all([
        unwrap<Omit<ProfessionalService, "commission_pct">[]>(supabase.from("professional_services").select(PROFESSIONAL_SERVICE_COLUMNS).eq("salon_id", salonId!)),
        isAdmin ? commissionRates(salonId!) : null,
      ]);
      const pct = new Map((rates?.services ?? []).map((r) => [`${r.professional_id}:${r.service_id}`, r.commission_pct]));
      return list.map((s): ProfessionalService => ({ ...s, commission_pct: pct.get(`${s.professional_id}:${s.service_id}`) ?? null }));
    },
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
      if (s.id) {
        const { error } = await supabase.from("services").update(payload).eq("id", s.id);
        if (error) throw error;
        return s.id;
      }
      const { data, error } = await supabase.from("services").insert(payload).select("id").single();
      if (error) throw error;
      return data.id as string;
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
