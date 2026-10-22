import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useCampaignAudience, useCreateCampaign } from "@/hooks/useWhatsapp";
import { CAMPAIGN_AUDIENCES, SAMPLE_VARS, renderTemplate, unknownVariables } from "@/lib/crm";
import { errorMessage } from "@/lib/errors";
import { EMPTY, formatPhone, money } from "@/lib/format";
import { fmt, todayKey, zonedToUtc } from "@/lib/tz";

const CAMPAIGN_VARS = ["nome", "salao", "link_agendamento"];

/** Mensagem para um público pronto. Entra na fila e respeita janela, limite diário e opt-out. */
export function CampaignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const create = useCreateCampaign();
  const [audience, setAudience] = useState<string>("reativar");
  const [days, setDays] = useState(60);
  const [name, setName] = useState("");
  const [body, setBody] = useState("Oi, {nome}! Sentimos sua falta aqui no {salao}. Que tal reservar um horário? {link_agendamento}");
  const [when, setWhen] = useState({ day: "", time: "10:00" });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const { data: rows = [], isLoading } = useCampaignAudience(open ? audience : null, days);

  useEffect(() => {
    setExcluded(new Set());
  }, [audience, days]);

  useEffect(() => {
    if (open) {
      setName(CAMPAIGN_AUDIENCES.find((a) => a.value === audience)?.label ?? "");
      setWhen({ day: "", time: "10:00" });
    }
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = useMemo(() => rows.filter((r) => !excluded.has(r.client_id)), [rows, excluded]);
  const unknown = unknownVariables(body, CAMPAIGN_VARS);

  const submit = async () => {
    if (!name.trim()) return toast.error("Dê um nome para a campanha");
    if (body.trim().length < 5) return toast.error("Escreva a mensagem");
    if (unknown.length) return toast.error(`Variável desconhecida: {${unknown[0]}}`);
    if (!chosen.length) return toast.error("Nenhum cliente selecionado");
    const scheduledFor = when.day ? zonedToUtc(when.day, when.time || "10:00", tz) : undefined;
    if (scheduledFor && scheduledFor.getTime() < Date.now() - 60_000) return toast.error("Escolha um horário no futuro");
    try {
      await create.mutateAsync({ name: name.trim(), body: body.trim(), clientIds: chosen.map((r) => r.client_id), audience, scheduledFor: scheduledFor?.toISOString() });
      toast.success(`Campanha na fila para ${chosen.length} ${chosen.length === 1 ? "cliente" : "clientes"}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">Nova campanha</DialogTitle>
          <p className="text-sm text-muted-foreground">Sai aos poucos, dentro da janela de envio e do limite diário. Quem pediu para sair nunca recebe.</p>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Público</Label>
            <Select value={audience} onValueChange={setAudience}>
              <SelectTrigger aria-label="Público"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CAMPAIGN_AUDIENCES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{CAMPAIGN_AUDIENCES.find((a) => a.value === audience)?.hint}</p>
          </div>
          {audience === "reativar" ? (
            <div className="space-y-1.5">
              <Label htmlFor="camp-days" className="text-xs">Sem visita há pelo menos</Label>
              <div className="flex items-center gap-2">
                <Input id="camp-days" type="number" min={20} max={365} value={days} onChange={(e) => setDays(Math.max(20, Number(e.target.value) || 60))} />
                <span className="text-xs text-muted-foreground">dias</span>
              </div>
            </div>
          ) : <div />}
          <div className="space-y-1.5">
            <Label htmlFor="camp-name" className="text-xs">Nome da campanha</Label>
            <Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-[1fr_6.5rem] gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="camp-day" className="text-xs">Começar em (opcional)</Label>
              <Input id="camp-day" type="date" min={todayKey(tz)} value={when.day} onChange={(e) => setWhen({ ...when, day: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="camp-time" className="text-xs">Hora</Label>
              <Input id="camp-time" type="time" value={when.time} onChange={(e) => setWhen({ ...when, time: e.target.value })} />
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="camp-body">Mensagem</Label>
          <Textarea id="camp-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          <p className="text-xs text-muted-foreground">Variáveis: {CAMPAIGN_VARS.map((v) => `{${v}}`).join(" · ")}</p>
          {unknown.length > 0 && <p className="text-xs text-destructive">Variável desconhecida: {unknown.map((u) => `{${u}}`).join(", ")}</p>}
          <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-[#DCF8C6] px-3 py-2 text-sm text-[#111B21]">
            {renderTemplate(body, { ...SAMPLE_VARS, salao: salon!.name })}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="label-caps">Quem vai receber · {chosen.length} de {rows.length}</div>
            {rows.length > 0 && (
              <button type="button" className="text-xs font-semibold hover:underline"
                onClick={() => setExcluded(excluded.size ? new Set() : new Set(rows.map((r) => r.client_id)))}>
                {excluded.size ? "Marcar todos" : "Desmarcar todos"}
              </button>
            )}
          </div>
          <div className="max-h-56 overflow-y-auto rounded-xl border border-border">
            {isLoading && <p className="p-3 text-xs text-muted-foreground">Carregando público…</p>}
            {!isLoading && rows.length === 0 && <p className="p-3 text-xs text-muted-foreground">Ninguém neste público agora.</p>}
            {rows.map((r) => (
              <label key={r.client_id} className="flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
                <Checkbox checked={!excluded.has(r.client_id)} onCheckedChange={(v) => {
                  const next = new Set(excluded);
                  if (v) next.delete(r.client_id); else next.add(r.client_id);
                  setExcluded(next);
                }} />
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">{formatPhone(r.phone)}</span>
                <span className="w-24 text-right text-xs text-muted-foreground">{r.last_visit_at ? fmt(r.last_visit_at, "dd/MM/yy", tz) : EMPTY}</span>
                <span className="w-20 text-right text-xs tabular-nums">{money(r.total_spent ?? 0)}</span>
              </label>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending || !chosen.length}>Colocar {chosen.length || ""} na fila</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
