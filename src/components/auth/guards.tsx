import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { can, type Feature } from "@/lib/permissions";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { SalonSuspended } from "@/components/auth/SalonSuspended";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

/** Sem salão → criar no onboarding. Admin com onboarding pendente → terminar. */
export function RequireSalon() {
  const { salon, role, loading, memberships, isPlatformAdmin, salonBlocked, readOnly } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!salon && memberships.length === 0) return <Navigate to={isPlatformAdmin ? "/painel" : "/onboarding"} replace />;
  if (!salon && salonBlocked) return <SalonSuspended />;
  if (!salon) return <FullPageLoader />;
  if (salon.suspended_at && !readOnly) return <FullPageLoader label="Este salão está suspenso. Fale com o suporte." />;
  if (role === "admin" && !readOnly && !salon.onboarding_completed) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function RequireFeature({ feature }: { feature: Feature }) {
  const { role } = useAuth();
  if (!can(role, feature)) return <Navigate to="/agenda" replace />;
  return <Outlet />;
}

/** Painel SaaS: só para quem está em platform_admins. */
export function RequirePlatformAdmin() {
  const { isPlatformAdmin, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!isPlatformAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}

/** Entrada: super admin cai no Painel; equipe do salão, na agenda. */
export function HomeRedirect() {
  const { isPlatformAdmin, readOnly } = useAuth();
  return <Navigate to={isPlatformAdmin && !readOnly ? "/painel" : "/agenda"} replace />;
}
