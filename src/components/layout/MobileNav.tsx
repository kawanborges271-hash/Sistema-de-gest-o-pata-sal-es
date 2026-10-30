import { NavLink } from "react-router-dom";
import { CalendarDays, ChartNoAxesColumn, Menu, Percent, Receipt, Users, Wallet, type LucideIcon } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { can, type Feature } from "@/lib/permissions";
import { cn } from "@/lib/utils";

// Cada papel fica com as 4 primeiras que pode abrir: dono e recepção, a operação do dia;
// profissional, a própria agenda, o próprio painel, as clientes dele e a comissão.
const TABS: { title: string; url: string; icon: LucideIcon; feature: Feature }[] = [
  { title: "Agenda", url: "/agenda", icon: CalendarDays, feature: "agenda" },
  { title: "Meu painel", url: "/meu-painel", icon: ChartNoAxesColumn, feature: "meu_painel" },
  { title: "Clientes", url: "/clientes", icon: Users, feature: "clientes" },
  { title: "Comandas", url: "/comandas", icon: Receipt, feature: "comandas" },
  { title: "Caixa", url: "/caixa", icon: Wallet, feature: "caixa" },
  { title: "Comissão", url: "/comissoes", icon: Percent, feature: "comissoes" },
];

const tabClass = "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";

/** Barra de baixo no celular: as telas do dia a dia na palma da mão, o resto fica em "Mais". */
export function MobileNav() {
  const { role } = useAuth();
  const { setOpenMobile } = useSidebar();
  const tabs = TABS.filter((t) => can(role, t.feature)).slice(0, 4);

  return (
    <nav
      aria-label="Navegação principal"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map((t) => (
        <NavLink
          key={t.url}
          to={t.url}
          className={({ isActive }) => cn(tabClass, isActive ? "text-copper" : "text-muted-foreground")}
        >
          <t.icon className="h-5 w-5" />
          {t.title}
        </NavLink>
      ))}
      <button type="button" className={cn(tabClass, "text-muted-foreground")} onClick={() => setOpenMobile(true)}>
        <Menu className="h-5 w-5" />
        Mais
      </button>
    </nav>
  );
}
