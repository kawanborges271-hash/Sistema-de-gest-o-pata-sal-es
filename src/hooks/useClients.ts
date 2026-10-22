import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Appointment, Client, ClientNote, ClientOverview, ClientPhoto } from "@/lib/types";

export function useClientOverview() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["client-overview", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_overview")
        .select("*")
        .eq("salon_id", salonId!)
        .order("name")
        .limit(5000);
      if (error) throw error;
      return (data ?? []) as ClientOverview[];
    },
  });
}

export function useClient(id: string | undefined) {
  return useQuery({
    queryKey: ["client-overview", "one", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase.from("client_overview").select("*").eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as ClientOverview | null;
    },
  });
}

export function useClientHistory(id: string | undefined) {
  return useQuery({
    queryKey: ["client-history", id],
    enabled: Boolean(id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments")
        .select("*, items:appointment_items(*)")
        .eq("client_id", id!)
        .order("starts_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Appointment[];
    },
  });
}

/** Busca rápida para o seletor de cliente no agendamento. */
export function useClientSearch(term: string) {
  const salonId = useAuth().salon?.id;
  const q = term.trim();
  return useQuery({
    queryKey: ["client-search", salonId, q],
    enabled: Boolean(salonId),
    queryFn: async () => {
      let query = supabase.from("clients").select("id, name, phone").eq("salon_id", salonId!).is("archived_at", null);
      if (q) {
        const digits = q.replace(/\D/g, "");
        const like = `%${q.replace(/[%_,]/g, "")}%`;
        query = digits.length >= 4 ? query.or(`name.ilike.${like},phone.ilike.%${digits}%`) : query.ilike("name", like);
      }
      const { data, error } = await query.order("name").limit(20);
      if (error) throw error;
      return (data ?? []) as Pick<Client, "id" | "name" | "phone">[];
    },
  });
}

function useInvalidateClients() {
  const qc = useQueryClient();
  return () =>
    Promise.all(["client-overview", "client-search", "client-notes", "client-photos"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useSaveClient() {
  const salonId = useAuth().salon?.id;
  const userId = useAuth().user?.id;
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: async (c: Partial<Client> & { id?: string }) => {
      if (c.id) {
        const { error } = await supabase.from("clients").update(c).eq("id", c.id);
        if (error) throw error;
        return c.id;
      }
      const { data, error } = await supabase
        .from("clients")
        .insert({ ...c, salon_id: salonId, created_by: userId })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: invalidate,
  });
}

export function useClientNotes(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-notes", clientId],
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_notes")
        .select("*")
        .eq("client_id", clientId!)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ClientNote[];
    },
  });
}

export function useAddClientNote() {
  const salonId = useAuth().salon?.id;
  const { user, professionalId } = useAuth();
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: async (n: Pick<ClientNote, "client_id" | "kind" | "title" | "body" | "data">) => {
      const { error } = await supabase
        .from("client_notes")
        .insert({ ...n, salon_id: salonId, created_by: user?.id, professional_id: professionalId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useArchiveClientNote() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("client_notes").update({ archived_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useClientPhotos(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-photos", clientId],
    enabled: Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_photos")
        .select("*")
        .eq("client_id", clientId!)
        .is("archived_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const photos = (data ?? []) as ClientPhoto[];
      if (!photos.length) return [] as (ClientPhoto & { url: string | null })[];
      // bucket privado: URLs assinadas válidas por 1 hora
      const { data: signed } = await supabase.storage
        .from("client-photos")
        .createSignedUrls(photos.map((p) => p.storage_path), 3600);
      return photos.map((p, i) => ({ ...p, url: signed?.[i]?.signedUrl ?? null }));
    },
  });
}

export function useUploadClientPhoto() {
  const salonId = useAuth().salon?.id;
  const userId = useAuth().user?.id;
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: async ({ clientId, file, kind, caption }: { clientId: string; file: File; kind: ClientPhoto["kind"]; caption?: string }) => {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${salonId}/${clientId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("client-photos").upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const { error } = await supabase
        .from("client_photos")
        .insert({ salon_id: salonId, client_id: clientId, storage_path: path, kind, caption: caption || null, created_by: userId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
