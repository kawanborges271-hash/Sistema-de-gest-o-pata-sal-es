import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMoveUser } from "@/hooks/usePlatform";
import { ROLE_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import type { PlatformSalon, SalonRole } from "@/lib/types";

export type MoveTarget = { userId: string; name: string; fromSalonId: string | null; fromSalonName: string | null; role: SalonRole };

/** Move de um salão para outro (o vínculo antigo fica inativo) ou dá acesso a mais um salão. */
export function MoveUserDialog({ target, salons, onClose }: { target: MoveTarget | null; salons: PlatformSalon[]; onClose: () => void }) {
  const move = useMoveUser();
  const [to, setTo] = useState("");
  const [role, setRole] = useState<SalonRole>("recepcao");
  useEffect(() => {
    if (target) { setTo(""); setRole(target.role); }
  }, [target]);

  const submit = async () => {
    if (!target || !to) return toast.error("Escolha o salão de destino");
    try {
      await move.mutateAsync({ userId: target.userId, fromSalonId: target.fromSalonId, toSalonId: to, role });
      toast.success(target.fromSalonId ? "Usuário movido" : "Acesso liberado");
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">{target?.fromSalonId ? "Mover usuário" : "Dar acesso a outro salão"}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            {target?.fromSalonId
              ? `${target.name} sai de ${target.fromSalonName}. O histórico fica lá; só o acesso muda.`
              : `${target?.name} continua nos salões atuais e ganha acesso a mais um.`}
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Para o salão</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger aria-label="Salão de destino"><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {salons.filter((s) => s.id !== target?.fromSalonId).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}{s.suspended_at ? " (suspenso)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Papel no salão novo</Label>
            <Select value={role} onValueChange={(v) => setRole(v as SalonRole)}>
              <SelectTrigger aria-label="Papel"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(ROLE_LABEL) as SalonRole[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
            </Select>
            {role === "profissional" && <p className="text-xs text-muted-foreground">O administrador do salão liga o login à agenda em Profissionais.</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={move.isPending}>{target?.fromSalonId ? "Mover" : "Dar acesso"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
