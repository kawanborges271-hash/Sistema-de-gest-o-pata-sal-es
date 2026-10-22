import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown, Lightbulb } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { addDaysKey, todayKey, zonedToUtc } from "@/lib/tz";
import { NAV } from "./nav";

/** O alerta mais importante do momento, calculado com dados reais. */
function useInsight() {
  const { salon, role } = useAuth();
  return useQuery({
    queryKey: ["insight", salon?.id],
    enabled: Boolean(salon) && role !== "profissional",
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const tz = salon!.timezone;
      const tomorrow = addDaysKey(todayKey(tz), 1);
      const [{ count: tomorrowCount }, { data: overdue }] = await Promise.all([
        supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("salon_id", salon!.id)
          .in("status", ["agendado", "confirmado"])
          .gte("starts_at", zonedToUtc(tomorrow, "00:00", tz).toISOString())
          .lt("starts_at", zonedToUtc(addDaysKey(tomorrow, 1), "00:00", tz).toISOString()),
        supabase
          .from("client_overview")
          .select("id")
          .eq("salon_id", salon!.id)
          .is("archived_at", null)
          .is("next_appointment_at", null)
          .lt("next_return_at", new Date().toISOString())
          .limit(200),
      ]);
      const late = overdue?.length ?? 0;
      if (tomorrowCount === 0) {
        return { text: "Amanhã ainda não tem nenhum agendamento.", cta: "Ver clientes para chamar", to: "/clientes?filtro=retorno" };
      }
      if (late > 0) {
        return {
          text: `${late} ${late === 1 ? "cliente passou" : "clientes passaram"} da data de retorno e não ${late === 1 ? "tem" : "têm"} nada marcado.`,
          cta: "Ver lista",
          to: "/clientes?filtro=retorno",
        };
      }
      return { text: `Amanhã: ${tomorrowCount} ${tomorrowCount === 1 ? "agendamento" : "agendamentos"}. Confirme com antecedência.`, cta: "Abrir agenda", to: "/agenda" };
    },
  });
}

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const { can } = usePermissions();
  const insight = useInsight();

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="px-4 pb-2 pt-5">
        <Logo compact={collapsed} />
      </SidebarHeader>

      <SidebarContent className="px-2 pt-2">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.feature || can(i.feature));
          if (!items.some((i) => i.feature)) return null;
          return (
            <Collapsible key={group.label} defaultOpen className="group/collapsible">
              <SidebarGroup className="py-1">
                {!collapsed && (
                  <SidebarGroupLabel asChild className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/45">
                    <CollapsibleTrigger className="flex w-full items-center">
                      {group.label}
                      <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=closed]/collapsible:-rotate-90" />
                    </CollapsibleTrigger>
                  </SidebarGroupLabel>
                )}
                <CollapsibleContent>
                  <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5">
                      {items.map((item) => {
                        const active = pathname.startsWith(item.url);
                        const soon = !item.feature;
                        return (
                          <SidebarMenuItem key={item.url}>
                            {soon ? (
                              <SidebarMenuButton
                                disabled
                                tooltip={`${item.title} · Fase ${item.phase}`}
                                className="h-9 cursor-default opacity-50"
                              >
                                <item.icon className="h-4 w-4" />
                                <span className="truncate text-sm">{item.title}</span>
                                <span className="ml-auto shrink-0 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[9px] uppercase tracking-wider">
                                  Fase {item.phase}
                                </span>
                              </SidebarMenuButton>
                            ) : (
                              <SidebarMenuButton asChild isActive={active} tooltip={item.title} className="h-9">
                                <NavLink to={item.url}>
                                  <item.icon className={cn("h-4 w-4", active && "text-copper")} />
                                  <span className={cn("text-sm", active && "font-semibold")}>{item.title}</span>
                                </NavLink>
                              </SidebarMenuButton>
                            )}
                          </SidebarMenuItem>
                        );
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </CollapsibleContent>
              </SidebarGroup>
            </Collapsible>
          );
        })}

        {!collapsed && insight.data && (
          <div className="mx-2 mb-4 mt-4 rounded-2xl border border-sidebar-border bg-card p-4 shadow-soft">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-copper">
              <Lightbulb className="h-3.5 w-3.5" /> Insight
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-sidebar-foreground">{insight.data.text}</p>
            <NavLink to={insight.data.to} className="mt-2 inline-block text-xs font-semibold text-accent-foreground underline-offset-4 hover:underline">
              {insight.data.cta} →
            </NavLink>
          </div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
