import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { can, type Feature } from "@/lib/permissions";
import { FullPageLoader } from "@/components/common/FullPageLoader";

export function RequireAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Outlet />;
}

/** Sem salão → criar no onboarding. Admin com onboarding pendente → terminar. */
export function RequireSalon() {
  const { salon, role, loading, memberships } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!salon && memberships.length === 0) return <Navigate to="/onboarding" replace />;
  if (!salon) return <FullPageLoader />;
  if (salon.suspended_at) return <FullPageLoader label="Este salão está suspenso. Fale com o suporte." />;
  if (role === "admin" && !salon.onboarding_completed) return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

export function RequireFeature({ feature }: { feature: Feature }) {
  const { role } = useAuth();
  if (!can(role, feature)) return <Navigate to="/agenda" replace />;
  return <Outlet />;
}
