import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { setReadOnlyMode, supabase } from "@/integrations/supabase/client";
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
  /** Super admin vendo um salão como suporte: tudo aparece, nada se altera. */
  readOnly: boolean;
  enterSupport: (salonId: string) => Promise<void>;
  exitSupport: () => void;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  switchSalon: (salonId: string) => Promise<void>;
};

const SUPPORT_KEY = "salon-os:suporte";

function readSupportSalon(): string | null {
  try {
    return sessionStorage.getItem(SUPPORT_KEY);
  } catch {
    return null;
  }
}

function writeSupportSalon(id: string | null) {
  try {
    if (id) sessionStorage.setItem(SUPPORT_KEY, id);
    else sessionStorage.removeItem(SUPPORT_KEY);
  } catch {
    // sem sessionStorage o modo suporte dura só até recarregar a página
  }
}

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
  const [supportSalonId, setSupportSalonId] = useState<string | null>(readSupportSalon);

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

    const support = pa ? readSupportSalon() : null;
    setReadOnlyMode(Boolean(support));
    if (support) {
      const { data: s } = await supabase.from("salons").select("*").eq("id", support).maybeSingle();
      setSalon(s as Salon | null);
      setSalonBlocked(false);
      setProfessionalId(null);
      return;
    }

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

  const enterSupport = useCallback(
    async (salonId: string) => {
      const { error } = await supabase.rpc("platform_view_salon", { p_salon_id: salonId });
      if (error) throw error;
      writeSupportSalon(salonId);
      setSupportSalonId(salonId);
      await refresh();
    },
    [refresh],
  );

  const exitSupport = useCallback(() => {
    writeSupportSalon(null);
    setSupportSalonId(null);
    setReadOnlyMode(false);
    void refresh();
  }, [refresh]);

  const signOut = async () => {
    writeSupportSalon(null);
    setSupportSalonId(null);
    setReadOnlyMode(false);
    await supabase.auth.signOut();
    clear();
  };

  const readOnly = Boolean(isPlatformAdmin && supportSalonId && salon?.id === supportSalonId);
  const role = readOnly ? "admin" : (salon && memberships.find((m) => m.salon_id === salon.id)?.role) || null;

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
        readOnly,
        enterSupport,
        exitSupport,
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
