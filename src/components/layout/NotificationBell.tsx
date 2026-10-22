import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMarkNotificationsRead, useNotifications } from "@/hooks/useNotifications";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Sino: lead novo, agendamento pelo link, pedido de remarcação e nota baixa. */
export function NotificationBell() {
  const navigate = useNavigate();
  const { data: items = [] } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const unread = items.filter((n) => !n.read).length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-muted" aria-label={unread ? `Notificações, ${unread} novas` : "Notificações"}>
        <Bell className="h-4 w-4 text-foreground/70" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-copper px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 text-sm">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-medium">Notificações</span>
          {unread > 0 && (
            <button type="button" className="text-xs font-semibold hover:underline" onClick={() => markRead.mutate()}>Marcar todas como lidas</button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-4 py-6 text-muted-foreground">Nada novo por aqui. Leads, reservas pelo link e respostas do WhatsApp aparecem neste sino.</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button type="button" className={cn("flex w-full gap-3 px-4 py-3 text-left hover:bg-muted/60", !n.read && "bg-accent/40")}
                  onClick={() => {
                    setOpen(false);
                    if (!n.read) markRead.mutate();
                    if (n.link) navigate(n.link);
                  }}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-copper")} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{n.title}</span>
                    {n.body && <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
