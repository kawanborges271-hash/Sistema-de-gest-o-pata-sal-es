import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOST_REASONS } from "@/lib/crm";
import { cn } from "@/lib/utils";

/** Mover para "Perdido" pede o motivo (vira dado para a Inteligência depois). */
export function LostReasonDialog({ open, name, onCancel, onConfirm }: {
  open: boolean;
  name: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [choice, setChoice] = useState<string>("");
  const [other, setOther] = useState("");
  useEffect(() => {
    if (open) {
      setChoice("");
      setOther("");
    }
  }, [open]);
  const reason = choice === "Outro" ? other.trim() : choice;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">Por que {name} foi perdido?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {LOST_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setChoice(r)}
              className={cn("rounded-full border px-3 py-1.5 text-sm transition-colors",
                choice === r ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}>
              {r}
            </button>
          ))}
        </div>
        {choice === "Outro" && <Input autoFocus placeholder="Conte o motivo" value={other} onChange={(e) => setOther(e.target.value)} />}
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>Voltar</Button>
          <Button disabled={!reason} onClick={() => onConfirm(reason)}>Marcar como perdido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
