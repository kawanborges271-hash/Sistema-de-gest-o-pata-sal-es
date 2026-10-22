import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Membership, Profile, Salon, SalonRole } from "@/lib/types";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  salon: Salon | null;
  role: SalonRole | null;
  /** id em professionals quando o usuário logado é um profissional do salão */
  professionalId: string | null;
  memberships: Membership[];
  isPlatformAdmin: boolean;
  /** Tem vínculo com o salão, mas ele não abre (suspenso pelo suporte). */
  salonBlocked: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  switchSalon: (salonId: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [salon, setSalon] = useState<Salon | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [professionalId, setProfessionalId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [salonBlocked, setSalonBlocked] = useState(false);
  const [loading, setLoading] = useState(true);

  const clear = () => {
    setProfile(null);
    setSalon(null);
    setMemberships([]);
    setProfessionalId(null);
    setIsPlatformAdmin(false);
    setSalonBlocked(false);
  };

  const load = useCallback(async (userId: string) => {
    const [{ data: prof }, { data: members }, { data: pa }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("salon_members").select("*, salon:salons(id, name)").eq("user_id", userId).eq("active", true),
      supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
    ]);
    const list = (members ?? []) as Membership[];
    setProfile(prof as Profile | null);
    setMemberships(list);
    setIsPlatformAdmin(Boolean(pa));

    const salonId =
      (prof?.current_salon_id && list.some((m) => m.salon_id === prof.current_salon_id) && prof.current_salon_id) ||
      list[0]?.salon_id ||
      null;
    if (!salonId) {
      setSalon(null);
      setProfessionalId(null);
      setSalonBlocked(false);
      return;
    }
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("salons").select("*").eq("id", salonId).maybeSingle(),
      supabase.from("professionals").select("id").eq("salon_id", salonId).eq("user_id", userId).maybeSingle(),
    ]);
    setSalon(s as Salon | null);
    setSalonBlocked(!s);
    setProfessionalId(p?.id ?? null);
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) clear();
      // fora do callback para não travar o cliente de auth
      else setTimeout(() => load(next.user.id), 0);
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await load(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(async () => {
    if (session) await load(session.user.id);
  }, [session, load]);

  const switchSalon = useCallback(
    async (salonId: string) => {
      const { error } = await supabase.rpc("switch_salon", { p_salon_id: salonId });
      if (error) throw error;
      await refresh();
    },
    [refresh],
  );

  const signOut = async () => {
    await supabase.auth.signOut();
    clear();
  };

  const role = (salon && memberships.find((m) => m.salon_id === salon.id)?.role) || null;

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        profile,
        salon,
        role,
        professionalId,
        memberships,
        isPlatformAdmin,
        salonBlocked,
        loading,
        signOut,
        refresh,
        switchSalon,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de AuthProvider");
  return ctx;
}

/** Atalho para telas que só existem com salão carregado. */
export function useSalon() {
  const { salon } = useAuth();
  if (!salon) throw new Error("Salão não carregado");
  return salon;
}
