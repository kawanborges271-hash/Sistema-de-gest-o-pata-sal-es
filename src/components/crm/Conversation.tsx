import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useConversation, usePendingTo, useSendWhatsapp } from "@/hooks/useCrm";
import { errorMessage } from "@/lib/errors";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";

/** Conversa do WhatsApp com envio pela fila (respeita janela, limite e opt-out). */
export function Conversation({ phone, leadId, clientId, optedOut, className }: {
  phone: string | null;
  leadId?: string | null;
  clientId?: string | null;
  optedOut?: boolean;
  className?: string;
}) {
  const tz = useAuth().salon!.timezone;
  const { data: messages = [], isLoading } = useConversation(phone, { leadId, clientId });
  const { data: pending = [] } = usePendingTo(phone);
  const send = useSendWhatsapp();
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length, pending.length]);

  const submit = async () => {
    if (!phone || !text.trim()) return;
    try {
      await send.mutateAsync({ phone, body: text.trim(), leadId, clientId });
      setText("");
      toast.success("Mensagem na fila de envio");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div className={cn("flex flex-col rounded-2xl border border-border bg-muted/40", className)}>
      <div className="max-h-80 min-h-32 space-y-2 overflow-y-auto p-3">
        {isLoading && <p className="text-xs text-muted-foreground">Carregando conversa…</p>}
        {!isLoading && messages.length === 0 && pending.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">Nenhuma mensagem ainda. O que chegar no WhatsApp do salão aparece aqui.</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm",
              m.direction === "out" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card shadow-soft")}>
              {m.body}
              <div className={cn("mt-1 text-[10px]", m.direction === "out" ? "text-primary-foreground/60" : "text-muted-foreground")}>
                {fmt(m.created_at, "dd/MM HH:mm", tz)}
              </div>
            </div>
          </div>
        ))}
        {pending.map((m) => (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-dashed border-primary/40 px-3 py-2 text-sm text-foreground/80">
              {m.body}
              <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><Clock className="h-3 w-3" /> na fila de envio</div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      {phone && (
        <div className="border-t border-border p-2">
          {optedOut ? (
            <p className="p-2 text-xs text-muted-foreground">Este número pediu para não receber mensagens (opt-out).</p>
          ) : (
            <div className="flex items-end gap-2">
              <Textarea rows={2} placeholder="Escreva uma mensagem…" value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
                className="min-h-0 resize-none bg-card" />
              <Button size="icon" aria-label="Enviar" disabled={!text.trim() || send.isPending} onClick={submit}><Send className="h-4 w-4" /></Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
