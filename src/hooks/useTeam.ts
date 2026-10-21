import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Invitation, SalonRole } from "@/lib/types";

export type Member = {
  id: string;
  user_id: string;
  role: SalonRole;
  active: boolean;
  created_at: string;
  profile: { full_name: string | null; email: string | null } | null;
};

export function useMembers() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["members", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("salon_members")
        .select("id, user_id, role, active, created_at, profile:profiles!salon_members_profile_fk(full_name, email)")
        .eq("salon_id", salonId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as Member[];
    },
  });
}

export function useInvitations() {
  const salonId = useAuth().salon?.id;
  return useQuery({
    queryKey: ["invitations", salonId],
    enabled: Boolean(salonId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invitations")
        .select("*")
        .eq("salon_id", salonId!)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Invitation[];
    },
  });
}

export type InviteResult = { link: string; emailed: boolean };

export function useInvite() {
  const salonId = useAuth().salon?.id;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { email: string; role: SalonRole; full_name?: string } | { resend: string }) => {
      const body =
        "resend" in input
          ? { action: "resend", invitation_id: input.resend, app_url: window.location.origin }
          : { action: "invite", salon_id: salonId, ...input, app_url: window.location.origin };
      const { data, error } = await supabase.functions.invoke("team-invite", { body });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        const detail = ctx ? await ctx.json().catch(() => null) : null;
        throw new Error(detail?.error ?? error.message);
      }
      return data as InviteResult;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; role?: SalonRole; active?: boolean }) => {
      const { error } = await supabase.from("salon_members").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members"] }),
  });
}
