import { Outlet } from "react-router-dom";
import { Bell, Check, LogOut } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABEL } from "@/lib/agenda";
import { initials } from "@/lib/format";
import { AppSidebar } from "./AppSidebar";
import { GlobalSearch } from "./GlobalSearch";

export default function AppLayout() {
  const { profile, user, salon, role, memberships, signOut, switchSalon } = useAuth();
  const name = profile?.full_name || user?.email?.split("@")[0] || "Usuário";

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur md:px-6">
            <SidebarTrigger className="text-foreground/70" />
            <GlobalSearch />
            <div className="ml-auto flex items-center gap-2">
              <Popover>
                <PopoverTrigger className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted" aria-label="Notificações">
                  <Bell className="h-4 w-4 text-foreground/70" />
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 text-sm">
                  <div className="font-medium">Notificações</div>
                  <p className="mt-1 text-muted-foreground">
                    Nada novo por aqui. Confirmações e respostas do WhatsApp vão aparecer neste sino.
                  </p>
                </PopoverContent>
              </Popover>
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
