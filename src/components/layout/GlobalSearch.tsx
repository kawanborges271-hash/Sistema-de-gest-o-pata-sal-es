import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Scissors, Search, User } from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatPhone } from "@/lib/format";
import { fmtDateTime } from "@/lib/tz";

/** Busca global (Ctrl+K): clientes, próximos agendamentos e serviços. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const { salon } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = term.trim();
  const { data } = useQuery({
    queryKey: ["global-search", salon?.id, q],
    enabled: open && Boolean(salon) && q.length >= 2,
    queryFn: async () => {
      const like = `%${q.replace(/[%_]/g, "")}%`;
      const digits = q.replace(/\D/g, "");
      const clientFilter = digits.length >= 4 ? `name.ilike.${like},phone.ilike.%${digits}%` : `name.ilike.${like}`;
      const [clients, services, appts] = await Promise.all([
        supabase.from("clients").select("id, name, phone").eq("salon_id", salon!.id).is("archived_at", null).or(clientFilter).limit(6),
        supabase.from("services").select("id, name").eq("salon_id", salon!.id).eq("active", true).ilike("name", like).limit(5),
        supabase
          .from("appointments")
          .select("id, starts_at, client:clients!inner(name)")
          .eq("salon_id", salon!.id)
          .in("status", ["agendado", "confirmado"])
          .gte("starts_at", new Date().toISOString())
          .ilike("client.name", like)
          .order("starts_at")
          .limit(5),
      ]);
      return {
        clients: clients.data ?? [],
        services: services.data ?? [],
        appointments: (appts.data ?? []) as unknown as { id: string; starts_at: string; client: { name: string } }[],
      };
    },
  });

  const go = (to: string) => {
    setOpen(false);
    setTerm("");
    navigate(to);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="hidden h-10 w-full max-w-md items-center gap-2 rounded-full bg-muted/70 px-4 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        <Search className="h-4 w-4" />
        Buscar clientes, agendamentos, serviços…
        <kbd className="ml-auto rounded border border-border bg-card px-1.5 text-[10px]">Ctrl K</kbd>
      </button>
      <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-muted md:hidden" aria-label="Buscar">
        <Search className="h-4 w-4" />
      </button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput placeholder="Digite um nome, telefone ou serviço…" value={term} onValueChange={setTerm} />
        <CommandList>
          <CommandEmpty>{q.length < 2 ? "Digite pelo menos 2 letras." : "Nada encontrado."}</CommandEmpty>
          {!!data?.clients.length && (
            <CommandGroup heading="Clientes">
              {data.clients.map((c) => (
                <CommandItem key={c.id} value={`c-${c.id}-${c.name}`} onSelect={() => go(`/clientes/${c.id}`)}>
                  <User className="mr-2 h-4 w-4" />
                  {c.name}
                  <span className="ml-auto text-xs text-muted-foreground">{formatPhone(c.phone)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!data?.appointments.length && (
            <CommandGroup heading="Próximos agendamentos">
              {data.appointments.map((a) => (
                <CommandItem key={a.id} value={`a-${a.id}-${a.client.name}`} onSelect={() => go(`/agenda?agendamento=${a.id}`)}>
                  <CalendarDays className="mr-2 h-4 w-4" />
                  {a.client.name}
                  <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(a.starts_at, salon?.timezone)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!data?.services.length && (
            <CommandGroup heading="Serviços">
              {data.services.map((s) => (
                <CommandItem key={s.id} value={`s-${s.id}-${s.name}`} onSelect={() => go(`/servicos?servico=${s.id}`)}>
                  <Scissors className="mr-2 h-4 w-4" />
                  {s.name}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}
