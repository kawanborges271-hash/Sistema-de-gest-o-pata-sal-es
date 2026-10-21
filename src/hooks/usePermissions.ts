import { useAuth } from "@/contexts/AuthContext";
import { can as canRole, type Feature } from "@/lib/permissions";

export function usePermissions() {
  const { role } = useAuth();
  return { role, can: (f: Feature) => canRole(role, f) };
}
