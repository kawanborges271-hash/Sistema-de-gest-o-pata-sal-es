import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProfessionals } from "@/hooks/useCatalog";
import { useCreateBlock } from "@/hooks/useAgenda";
import { useAuth } from "@/contexts/AuthContext";
import { BLOCK_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { zonedToUtc } from "@/lib/tz";
import type { BlockKind } from "@/lib/types";

export function BlockDialog({ open, onOpenChange, day, professionalId }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  day: string;
  professionalId?: string | null;
}) {
  const { salon, role, professionalId: mine } = useAuth();
  const { data: pros = [] } = useProfessionals();
  const create = useCreateBlock();
  const [form, setForm] = useState({ professional_id: "all", kind: "bloqueio" as BlockKind, reason: "", from_day: day, from: "12:00", to_day: day, to: "13:00" });

  useEffect(() => {
    if (open) setForm((f) => ({ ...f, professional_id: role === "profissional" ? mine ?? "all" : professionalId ?? "all", from_day: day, to_day: day, reason: "" }));
  }, [open, day, professionalId, role, mine]);

  const submit = async () => {
    const tz = salon!.timezone;
    const starts = zonedToUtc(form.from_day, form.from, tz);
    const ends = zonedToUtc(form.to_day, form.to, tz);
    if (ends <= starts) return toast.error("O fim precisa ser depois do início");
    try {
      await create.mutateAsync({
        professional_id: form.professional_id === "all" ? null : form.professional_id,
        kind: form.kind,
        reason: form.reason.trim() || null,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      });
      toast.success("Horário bloqueado");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="font-display font-medium">Bloquear horário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Quem</Label>
              <Select value={form.professional_id} onValueChange={(v) => setForm({ ...form, professional_id: v })} disabled={role === "profissional"}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Salão inteiro</SelectItem>
                  {pros.filter((p) => p.active).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as BlockKind })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(BLOCK_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label>De</Label><Input type="date" value={form.from_day} onChange={(e) => setForm({ ...form, from_day: e.target.value, to_day: e.target.value > form.to_day ? e.target.value : form.to_day })} /></div>
            <div className="space-y-1"><Label>&nbsp;</Label><Input type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></div>
            <div className="space-y-1"><Label>Até</Label><Input type="date" value={form.to_day} onChange={(e) => setForm({ ...form, to_day: e.target.value })} /></div>
            <div className="space-y-1"><Label>&nbsp;</Label><Input type="time" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></div>
          </div>
          <div className="space-y-1"><Label>Motivo (opcional)</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ex.: curso de visagismo" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={create.isPending}>Bloquear</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
