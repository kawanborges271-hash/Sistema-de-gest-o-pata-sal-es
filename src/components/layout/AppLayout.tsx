import { Link, Outlet } from "react-router-dom";
import { useEffect } from "react";
import { Check, LogOut, ShieldCheck } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/lib/agenda";
import { initials } from "@/lib/format";
import { AppSidebar } from "./AppSidebar";
import { GlobalSearch } from "./GlobalSearch";
import { NotificationBell } from "./NotificationBell";

export default function AppLayout() {
  const { profile, user, salon, role, memberships, isPlatformAdmin, signOut, switchSalon } = useAuth();
  const name = profile?.full_name || user?.email?.split("@")[0] || "Usuário";

  // Links que saem no WhatsApp ({link_agendamento}) usam o endereço onde o sistema está publicado
  useEffect(() => {
    const origin = window.location.origin;
    if (role === "admin" && salon && salon.app_url !== origin && !/localhost|127\.0\.0\.1/.test(origin)) {
      supabase.from("salons").update({ app_url: origin }).eq("id", salon.id).then(() => undefined);
    }
  }, [role, salon]);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
            <SidebarTrigger className="text-foreground/70" />
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-2">
              <NotificationBell />
              <DropdownMenu>
                <DropdownMenuTrigger className="flex items-center gap-3 border-l border-border pl-3 outline-none">
                  <div className="hidden text-right leading-tight sm:block">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground">
                      {salon?.name}
                      {role && ` · ${ROLE_LABEL[role]}`}
                    </div>
                  </div>
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                      {initials(name) || "SO"}
                    </AvatarFallback>
                  </Avatar>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuLabel className="font-normal">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="truncate text-xs text-muted-foreground">{user?.email}</div>
                  </DropdownMenuLabel>
                  {memberships.length > 1 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="label-caps">Trocar de salão</DropdownMenuLabel>
                      {memberships.map((m) => (
                        <DropdownMenuItem key={m.salon_id} onClick={() => switchSalon(m.salon_id)}>
                          {m.salon?.name}
                          {m.salon_id === salon?.id && <Check className="ml-auto h-4 w-4" />}
                        </DropdownMenuItem>
                      ))}
                    </>
                  )}
                  {isPlatformAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link to="/painel"><ShieldCheck className="mr-2 h-4 w-4" /> Painel SaaS</Link>
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={signOut} className="text-destructive focus:text-destructive">
                    <LogOut className="mr-2 h-4 w-4" /> Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 px-4 py-6 md:px-8 lg:px-10 lg:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
