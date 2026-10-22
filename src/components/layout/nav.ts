import {
  ShieldCheck, Boxes, Brain, CalendarDays, Gift, KanbanSquare, LayoutDashboard, Megaphone, MessageCircle,
  Package, Percent, Receipt, Scissors, Settings, UserCog, Users, Wallet, type LucideIcon,
} from "lucide-react";
import type { Feature } from "@/lib/permissions";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  /** sem feature = ainda não lançado (aparece como "em breve") */
  feature?: Feature;
  phase?: number;
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Operação",
    items: [
      { title: "Agenda", url: "/agenda", icon: CalendarDays, feature: "agenda" },
      { title: "Clientes", url: "/clientes", icon: Users, feature: "clientes" },
      { title: "Comandas", url: "/comandas", icon: Receipt, feature: "comandas" },
      { title: "Caixa", url: "/caixa", icon: Wallet, feature: "caixa" },
      { title: "CRM", url: "/crm", icon: KanbanSquare, feature: "crm" },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { title: "Serviços", url: "/servicos", icon: Scissors, feature: "servicos" },
      { title: "Profissionais", url: "/profissionais", icon: UserCog, feature: "profissionais" },
      { title: "Produtos & Estoque", url: "/estoque", icon: Boxes, feature: "estoque" },
      { title: "Pacotes", url: "/pacotes", icon: Package, feature: "pacotes" },
    ],
  },
  {
    label: "Vendas",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, phase: 4 },
      { title: "Marketing & Vendas", url: "/marketing", icon: Megaphone, phase: 4 },
      { title: "Inteligência", url: "/inteligencia", icon: Brain, phase: 4 },
      { title: "Automações", url: "/automacoes", icon: MessageCircle, feature: "automacoes" },
      { title: "Fidelidade", url: "/fidelidade", icon: Gift, phase: 4 },
    ],
  },
  {
    label: "Gestão",
    items: [
      { title: "Comissões", url: "/comissoes", icon: Percent, feature: "comissoes" },
      { title: "Equipe", url: "/equipe", icon: ShieldCheck, feature: "equipe" },
      { title: "Configurações", url: "/configuracoes", icon: Settings, feature: "configuracoes" },
    ],
  },
];
