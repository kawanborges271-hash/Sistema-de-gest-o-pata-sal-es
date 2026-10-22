import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { AppNotification } from "@/lib/types";

/** Últimas notificações do salão para o papel de quem está logado (RLS), com o "lido" por pessoa */
export function useNotifications() {
  const { salon, user, role } = useAuth();
  return useQuery({
    queryKey: ["notifications", salon?.id, user?.id],
    enabled: Boolean(salon && user) && role !== "profissional",
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("notifications")
        .select("id, kind, title, body, link, created_at, reads:notification_reads(user_id)")
        .eq("salon_id", salon!.id).order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return (data ?? []).map((n) => ({
        id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, created_at: n.created_at,
        read: (n.reads as { user_id: string }[] | null)?.some((r) => r.user_id === user!.id) ?? false,
      })) as AppNotification[];
    },
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const salonId = useAuth().salon?.id;
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("mark_notifications_read", { p_salon_id: salonId });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
