import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SectionCard } from "@/components/common/SectionCard";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { bookingUrl } from "@/lib/crm";
import { errorMessage } from "@/lib/errors";

/** Link público /agendar/[slug]: horários livres de verdade e confirmação no WhatsApp. */
export function OnlineBookingCard() {
  const { salon, refresh } = useAuth();
  const [form, setForm] = useState(() => fromSalon());
  const [saving, setSaving] = useState(false);
  const url = bookingUrl(salon!.slug);

  function fromSalon() {
    return {
      online_booking_enabled: salon!.online_booking_enabled,
      online_booking_min_hours: salon!.online_booking_min_hours,
      online_booking_max_days: salon!.online_booking_max_days,
      online_booking_step_minutes: salon!.online_booking_step_minutes,
      online_booking_message: salon!.online_booking_message ?? "",
    };
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setForm(fromSalon()), [salon]);

  const submit = async () => {
    setSaving(true);
    const { error } = await supabase.from("salons").update({
      ...form, online_booking_message: form.online_booking_message.trim() || null,
    }).eq("id", salon!.id);
    setSaving(false);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    toast.success("Agendamento online salvo");
  };

  return (
    <SectionCard title="Agendamento online" hint="A cliente escolhe serviço, profissional e um horário livre. Entra na agenda com origem Link online e recebe a confirmação no WhatsApp.">
      <div className="space-y-4">
        <div className="flex gap-2">
          <Input readOnly value={url} className="font-mono text-xs" aria-label="Link de agendamento" />
          <Button variant="outline" size="icon" aria-label="Copiar link" onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              toast.success("Link copiado");
            } catch {
              toast.error("Não foi possível copiar");
            }
          }}><Copy className="h-4 w-4" /></Button>
          <Button variant="outline" size="icon" asChild aria-label="Abrir link"><a href={url} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>
        </div>
        <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
          Aceitar agendamentos pelo link
          <Switch checked={form.online_booking_enabled} onCheckedChange={(v) => setForm({ ...form, online_booking_enabled: v })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ob-min" className="text-xs">Antecedência mínima (horas)</Label>
            <Input id="ob-min" type="number" min={0} max={168} value={form.online_booking_min_hours}
              onChange={(e) => setForm({ ...form, online_booking_min_hours: Math.min(168, Math.max(0, Number(e.target.value) || 0)) })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob-max" className="text-xs">Até quantos dias à frente</Label>
            <Input id="ob-max" type="number" min={1} max={180} value={form.online_booking_max_days}
              onChange={(e) => setForm({ ...form, online_booking_max_days: Math.min(180, Math.max(1, Number(e.target.value) || 1)) })} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Horários a cada</Label>
            <Select value={String(form.online_booking_step_minutes)} onValueChange={(v) => setForm({ ...form, online_booking_step_minutes: Number(v) })}>
              <SelectTrigger aria-label="Intervalo dos horários"><SelectValue /></SelectTrigger>
              <SelectContent>{[5, 10, 15, 20, 30, 60].map((m) => <SelectItem key={m} value={String(m)}>{m} min</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ob-msg" className="text-xs">Recado no topo da página (opcional)</Label>
          <Textarea id="ob-msg" rows={2} maxLength={500} value={form.online_booking_message} onChange={(e) => setForm({ ...form, online_booking_message: e.target.value })}
            placeholder="Ex.: Tolerância de 10 minutos. Para mechas, chame no WhatsApp." />
        </div>
        <p className="text-xs text-muted-foreground">Aparecem só os serviços marcados como ativos e os profissionais com agenda. Uma mesma pessoa pode ter até 3 horários futuros pelo link.</p>
        <Button onClick={submit} disabled={saving}>Salvar</Button>
      </div>
    </SectionCard>
  );
}
