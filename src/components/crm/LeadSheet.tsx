import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Archive, CalendarPlus, MessageCircle, UserRound, Zap } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useArchiveLead, useConvertLead, useLeadHistory, useMoveLead, useSaveLead } from "@/hooks/useCrm";
import { useOptOuts } from "@/hooks/useWhatsapp";
import { CLIENT_ORIGIN_LABEL } from "@/lib/agenda";
import { LEAD_STAGE_DOT, LEAD_STAGE_LABEL, LEAD_STAGES, phoneKey } from "@/lib/crm";
import { errorMessage } from "@/lib/errors";
import { formatPhone } from "@/lib/format";
import { dayKey, fmt, fmtTime, zonedToUtc } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Lead, LeadStage } from "@/lib/types";
import { Conversation } from "./Conversation";

export function LeadSheet({ lead, onOpenChange, onAskLost, onSchedule }: {
  lead: Lead | null;
  onOpenChange: (o: boolean) => void;
  onAskLost: (lead: Lead) => void;
  onSchedule: (clientId: string, name: string, phone: string | null) => void;
}) {
  const tz = useAuth().salon!.timezone;
  const move = useMoveLead();
  const save = useSaveLead();
  const convert = useConvertLead();
  const archive = useArchiveLead();
  const { data: history = [] } = useLeadHistory(lead?.id ?? null);
  const { data: optOuts = [] } = useOptOuts();
  const [form, setForm] = useState({ interest: "", notes: "", fuDay: "", fuTime: "" });

  useEffect(() => {
    if (!lead) return;
    setForm({
      interest: lead.interest ?? "",
      notes: lead.notes ?? "",
      fuDay: lead.next_follow_up_at ? dayKey(lead.next_follow_up_at, tz) : "",
      fuTime: lead.next_follow_up_at ? fmtTime(lead.next_follow_up_at, tz) : "10:00",
    });
  }, [lead, tz]);

  if (!lead) return <Sheet open={false} onOpenChange={onOpenChange}><SheetContent /></Sheet>;

  const optedOut = optOuts.some((o) => phoneKey(o.phone) === phoneKey(lead.phone));
  const waLink = lead.phone ? `https://wa.me/${lead.phone}` : null;

  const changeStage = async (stage: LeadStage) => {
    if (stage === "perdido") return onAskLost(lead);
    try {
      await move.mutateAsync({ id: lead.id, stage });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const saveDetails = async () => {
    try {
      await save.mutateAsync({
        id: lead.id,
        interest: form.interest.trim() || null,
        notes: form.notes.trim() || null,
        next_follow_up_at: form.fuDay ? zonedToUtc(form.fuDay, form.fuTime || "10:00", tz).toISOString() : null,
      });
      toast.success("Lead atualizado");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const schedule = async () => {
    try {
      const clientId = lead.client_id ?? (await convert.mutateAsync(lead.id));
      onSchedule(clientId, lead.name, lead.phone);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="text-left">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{CLIENT_ORIGIN_LABEL[lead.origin]}</span>
            <span>·</span>
            <span>entrou em {fmt(lead.created_at, "dd/MM/yyyy", tz)}</span>
          </div>
          <SheetTitle className="font-display text-2xl font-light">{lead.name}</SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Etapa</Label>
              <Select value={lead.stage} onValueChange={(v) => changeStage(v as LeadStage)}>
                <SelectTrigger aria-label="Etapa do lead"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", LEAD_STAGE_DOT[s])} />{LEAD_STAGE_LABEL[s]}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={schedule} disabled={convert.isPending}><CalendarPlus className="mr-1 h-4 w-4" /> Agendar</Button>
          </div>
          {lead.stage === "perdido" && lead.lost_reason && (
            <p className="rounded-xl bg-muted px-3 py-2 text-sm">Motivo da perda: <b>{lead.lost_reason}</b></p>
          )}

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-sm">
            <span className="flex-1">{lead.phone ? formatPhone(lead.phone) : "Sem telefone"}</span>
            {waLink && (
              <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-success hover:underline">
                <MessageCircle className="h-4 w-4" /> Abrir no WhatsApp
              </a>
            )}
            {lead.client_id && (
              <Link to={`/clientes/${lead.client_id}`} className="inline-flex items-center gap-1 text-xs font-semibold hover:underline">
                <UserRound className="h-4 w-4" /> Ficha da cliente
              </Link>
            )}
          </div>

          <div>
            <div className="label-caps mb-2">Conversa</div>
            <Conversation phone={lead.phone} leadId={lead.id} clientId={lead.client_id} optedOut={optedOut} />
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead-int" className="text-xs">Interesse</Label>
              <Input id="lead-int" value={form.interest} onChange={(e) => setForm({ ...form, interest: e.target.value })} placeholder="O que ela quer fazer" />
            </div>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="lead-fu" className="text-xs">Próximo follow-up</Label>
                <Input id="lead-fu" type="date" value={form.fuDay} onChange={(e) => setForm({ ...form, fuDay: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lead-fu-time" className="text-xs">Hora</Label>
                <Input id="lead-fu-time" type="time" value={form.fuTime} onChange={(e) => setForm({ ...form, fuTime: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-obs" className="text-xs">Observações</Label>
              <Textarea id="lead-obs" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={saveDetails} disabled={save.isPending}>Salvar</Button>
              {form.fuDay && <Button variant="ghost" onClick={() => setForm({ ...form, fuDay: "" })}>Limpar follow-up</Button>}
            </div>
          </div>

          <div>
            <div className="label-caps mb-2">Histórico</div>
            <ol className="space-y-2 border-l border-border pl-4">
              {history.map((h) => (
                <li key={h.id} className="relative text-sm">
                  <span className={cn("absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-card", LEAD_STAGE_DOT[h.to_stage])} />
                  <span className="font-medium">{LEAD_STAGE_LABEL[h.to_stage]}</span>
                  {h.reason && <span className="text-muted-foreground"> · {h.reason}</span>}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    {fmt(h.changed_at, "dd/MM HH:mm", tz)}
                    {h.automatic && <span className="inline-flex items-center gap-0.5 rounded bg-accent px-1 text-[10px] text-accent-foreground"><Zap className="h-2.5 w-2.5" /> automático</span>}
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <Button variant="ghost" className="text-muted-foreground" onClick={async () => {
            try {
              await archive.mutateAsync(lead.id);
              toast.success("Lead arquivado");
              onOpenChange(false);
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}>
            <Archive className="mr-1 h-4 w-4" /> Arquivar lead
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
