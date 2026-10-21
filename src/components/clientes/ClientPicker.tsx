import { useState } from "react";
import { Check, ChevronsUpDown, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useClientSearch, useSaveClient } from "@/hooks/useClients";
import { formatPhone, normalizePhone } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type PickedClient = { id: string; name: string; phone: string | null };

/** Escolhe cliente existente ou cadastra na hora (nome + telefone). */
export function ClientPicker({ value, onChange }: { value: PickedClient | null; onChange: (c: PickedClient) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [creating, setCreating] = useState(false);
  const [phone, setPhone] = useState("");
  const { data: results = [], isFetching } = useClientSearch(term);
  const save = useSaveClient();

  const create = async () => {
    if (term.trim().length < 2) return toast.error("Digite o nome da cliente");
    try {
      const p = normalizePhone(phone);
      const id = await save.mutateAsync({ name: term.trim(), phone: p, origin: "outro" });
      onChange({ id, name: term.trim(), phone: p });
      setOpen(false);
      setCreating(false);
      setPhone("");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-10 w-full justify-between font-normal">
          {value ? (
            <span className="truncate">{value.name} <span className="text-muted-foreground">· {formatPhone(value.phone)}</span></span>
          ) : (
            <span className="text-muted-foreground">Buscar ou cadastrar cliente…</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Nome ou telefone" value={term} onValueChange={(v) => { setTerm(v); setCreating(false); }} />
          <CommandList>
            <CommandEmpty>{isFetching ? "Buscando…" : "Nenhuma cliente com esse nome."}</CommandEmpty>
            {results.length > 0 && (
              <CommandGroup>
                {results.map((c) => (
                  <CommandItem key={c.id} value={c.id} onSelect={() => { onChange(c); setOpen(false); }}>
                    <Check className={cn("mr-2 h-4 w-4", value?.id === c.id ? "opacity-100" : "opacity-0")} />
                    {c.name}
                    <span className="ml-auto text-xs text-muted-foreground">{formatPhone(c.phone)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="border-t border-border p-2">
            {creating ? (
              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Nova cliente: <b className="text-foreground">{term || "digite o nome acima"}</b></div>
                <Input placeholder="WhatsApp com DDD" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-9" />
                <Button size="sm" className="w-full" onClick={create} disabled={save.isPending}>Cadastrar e usar</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="w-full justify-start" onClick={() => setCreating(true)}>
                <UserPlus className="mr-2 h-4 w-4" /> Cadastrar {term ? `"${term}"` : "nova cliente"}
              </Button>
            )}
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
