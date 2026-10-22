import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useSaveAutomation } from "@/hooks/useWhatsapp";
import { supabase } from "@/integrations/supabase/client";
import { AUTOMATION_META, SAMPLE_VARS, VARIABLE_HINT, renderTemplate, unknownVariables } from "@/lib/crm";
import { errorMessage } from "@/lib/errors";
import type { Automation } from "@/lib/types";

/** Texto editável com variáveis, liga/desliga e ajustes de cada automação. */
export function AutomationDialog({ automation, onOpenChange }: {
  automation: Automation | null;
  onOpenChange: (o: boolean) => void;
}) {
  const { salon, refresh } = useAuth();
  const save = useSaveAutomation();
  const [template, setTemplate] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [settings, setSettings] = useState<Record<string, string | number>>({});
  const [reviewUrl, setReviewUrl] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!automation) return;
    setTemplate(automation.template);
    setEnabled(automation.enabled);
    setSettings({ ...automation.settings });
    setReviewUrl(salon?.google_review_url ?? "");
  }, [automation, salon?.google_review_url]);

  if (!automation) return null;
  const meta = AUTOMATION_META[automation.kind];
  const unknown = unknownVariables(template, meta.variables);
  const preview = renderTemplate(template, { ...SAMPLE_VARS, salao: salon?.name ?? SAMPLE_VARS.salao, cupom: String(settings.coupon ?? "") });

  const insertVar = (v: string) => {
    const el = area.current;
    const token = `{${v}}`;
    if (!el) return setTemplate((t) => `${t}${token}`);
    const start = el.selectionStart ?? template.length;
    const end = el.selectionEnd ?? template.length;
    setTemplate(template.slice(0, start) + token + template.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const submit = async () => {
    if (template.trim().length < 5) return toast.error("Escreva o texto da mensagem");
    if (unknown.length) return toast.error(`Variável desconhecida: {${unknown[0]}}`);
    const clean: Record<string, string | number> = {};
    for (const f of meta.fields ?? []) {
      const v = settings[f.key];
      if (f.type === "number") {
        const n = Number(v);
        if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) {
          return toast.error(`${f.label}: use um valor entre ${f.min} e ${f.max}`);
        }
        clean[f.key] = n;
      } else clean[f.key] = String(v ?? "");
    }
    try {
      await save.mutateAsync({ id: automation.id, template: template.trim(), enabled, settings: { ...automation.settings, ...clean } });
      if (automation.kind === "avaliacao_google" && reviewUrl.trim() !== (salon?.google_review_url ?? "")) {
        const url = reviewUrl.trim();
        if (url && !/^https?:\/\//.test(url)) return toast.error("O link do Google precisa começar com https://");
        const { error } = await supabase.from("salons").update({ google_review_url: url || null }).eq("id", salon!.id);
        if (error) throw error;
        await refresh();
      }
      toast.success("Automação salva");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">{meta.title}</DialogTitle>
          <p className="text-sm text-muted-foreground">{meta.when}</p>
        </DialogHeader>

        <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
          Automação ligada
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </label>

        <div className="space-y-2">
          <Label htmlFor="tpl">Texto da mensagem</Label>
          <Textarea id="tpl" ref={area} rows={5} value={template} onChange={(e) => setTemplate(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {meta.variables.map((v) => (
              <button key={v} type="button" title={VARIABLE_HINT[v]} onClick={() => insertVar(v)}
                className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] hover:bg-muted">
                {`{${v}}`}
              </button>
            ))}
          </div>
          {unknown.length > 0 && <p className="text-xs text-destructive">Esta automação não conhece {unknown.map((u) => `{${u}}`).join(", ")}.</p>}
        </div>

        <div className="space-y-1.5">
          <div className="label-caps">Prévia</div>
          <div className="whitespace-pre-wrap rounded-2xl rounded-bl-md bg-[#DCF8C6] px-3 py-2 text-sm text-[#111B21] shadow-soft">{preview}</div>
        </div>

        {(meta.fields ?? []).length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {meta.fields!.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`f-${f.key}`} className="text-xs">{f.label}</Label>
                <div className="flex items-center gap-2">
                  <Input id={`f-${f.key}`} type={f.type === "time" ? "time" : f.type === "number" ? "number" : "text"}
                    min={f.min} max={f.max} value={String(settings[f.key] ?? "")}
                    onChange={(e) => setSettings({ ...settings, [f.key]: e.target.value })} />
                  {f.suffix && <span className="shrink-0 text-xs text-muted-foreground">{f.suffix}</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {automation.kind === "avaliacao_google" && (
          <div className="space-y-1.5">
            <Label htmlFor="review-url" className="text-xs">Link de avaliação no Google</Label>
            <Input id="review-url" placeholder="https://g.page/r/.../review" value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)} />
            <p className="text-xs text-muted-foreground">No Perfil da Empresa no Google: "Pedir avaliações" → copiar link.</p>
          </div>
        )}

        <div className="rounded-xl bg-muted/60 p-3 text-sm">
          <div className="label-caps mb-1">O que acontece depois</div>
          {meta.after}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
