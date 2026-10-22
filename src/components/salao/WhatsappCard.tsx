import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, Link2, QrCode, RefreshCw, Send, ShieldCheck, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionCard } from "@/components/common/SectionCard";
import { useAuth } from "@/contexts/AuthContext";
import {
  type ConnectAction, useRotateWebhookSecret, useSaveWhatsappIntegration, useSetWhatsappActive, useWhatsappConnect,
  useWhatsappIntegration, webhookUrlFor,
} from "@/hooks/useWhatsapp";
import { errorMessage } from "@/lib/errors";
import { formatPhone, normalizePhone } from "@/lib/format";
import { fmt } from "@/lib/tz";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { label: string; cls: string }> = {
  conectado: { label: "Conectado", cls: "bg-success/10 text-success" },
  desconectado: { label: "Desconectado", cls: "bg-destructive/10 text-destructive" },
  erro: { label: "Erro", cls: "bg-destructive/10 text-destructive" },
  pendente: { label: "Não verificado", cls: "bg-muted text-muted-foreground" },
};

/** Integração Z-API. O token nunca volta para a tela: mostramos só os 4 últimos dígitos. */
export function WhatsappCard() {
  const { salon } = useAuth();
  const { data: wa, isLoading } = useWhatsappIntegration();
  const save = useSaveWhatsappIntegration();
  const setActive = useSetWhatsappActive();
  const rotate = useRotateWebhookSecret();
  const connect = useWhatsappConnect();
  const [form, setForm] = useState({ instanceId: "", token: "", clientToken: "", phone: "" });
  const [showUrl, setShowUrl] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [testPhone, setTestPhone] = useState("");

  useEffect(() => {
    if (wa) setForm((f) => ({ ...f, instanceId: wa.instance_id ?? "", phone: wa.phone ? formatPhone(wa.phone) : "" }));
  }, [wa]);

  const url = wa ? webhookUrlFor(salon!.id, wa.webhook_secret) : "";
  const masked = url.replace(/secret=.*/, "secret=••••••••••••");

  const submit = async () => {
    if (!form.instanceId.trim()) return toast.error("Informe o ID da instância");
    if (!wa?.configured && !form.token.trim()) return toast.error("Informe o token da instância");
    try {
      await save.mutateAsync({
        instanceId: form.instanceId.trim(), token: form.token.trim() || undefined, clientToken: form.clientToken.trim() || undefined,
        phone: form.phone ? normalizePhone(form.phone) ?? undefined : undefined,
      });
      setForm((f) => ({ ...f, token: "", clientToken: "" }));
      toast.success("Integração salva");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const run = async (action: ConnectAction) => {
    try {
      const r = await connect.mutateAsync({ action, phone: action === "test" ? normalizePhone(testPhone) ?? undefined : undefined });
      if (action === "qrcode") {
        if (r.image) setQr(r.image);
        else toast.success(r.status === "conectado" ? "O número já está conectado" : "A Z-API não devolveu o QR Code");
      } else if (action === "status") {
        if (r.status === "conectado") toast.success("WhatsApp conectado");
        else toast.error(r.error ?? "O número não está conectado. Leia o QR Code.");
      } else if (action === "webhook") {
        if (r.ok) toast.success("Webhook configurado na Z-API");
        else toast.error(r.error ?? "Não foi possível configurar o webhook");
      } else {
        if (r.ok) toast.success("Mensagem de teste enviada");
        else toast.error(r.error ?? "Falha no envio");
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("URL copiada. Trate como senha.");
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const st = STATUS[wa?.status ?? "pendente"];

  return (
    <SectionCard title="WhatsApp (Z-API)" hint="Conecte o número do salão para enviar confirmações, lembretes e campanhas e receber as conversas no CRM."
      actions={wa?.configured ? <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", st.cls)}>{st.label}</span> : undefined}>
      <div id="whatsapp" className="space-y-4">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-inst" className="text-xs">ID da instância</Label>
            <Input id="wa-inst" autoComplete="off" value={form.instanceId} onChange={(e) => setForm({ ...form, instanceId: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-phone" className="text-xs">Número conectado</Label>
            <Input id="wa-phone" placeholder="(11) 98888-7777" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-token" className="text-xs">Token da instância</Label>
            <Input id="wa-token" type="password" autoComplete="new-password" placeholder={wa?.token_hint ?? ""} value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })} />
            {wa?.configured && <p className="text-[11px] text-muted-foreground">Deixe em branco para manter o atual.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-ctoken" className="text-xs">Client-Token da conta (Segurança)</Label>
            <Input id="wa-ctoken" type="password" autoComplete="new-password" placeholder={wa?.client_token_set ? "••••••••" : "opcional"} value={form.clientToken}
              onChange={(e) => setForm({ ...form, clientToken: e.target.value })} />
          </div>
        </div>
        <Button onClick={submit} disabled={save.isPending}>Salvar integração</Button>

        {wa?.configured && (
          <>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => run("status")} disabled={connect.isPending}><Wifi className="mr-1 h-4 w-4" /> Verificar conexão</Button>
              <Button variant="outline" size="sm" onClick={() => run("qrcode")} disabled={connect.isPending}><QrCode className="mr-1 h-4 w-4" /> Ler QR Code</Button>
              <Button variant="outline" size="sm" onClick={() => run("webhook")} disabled={connect.isPending}><Link2 className="mr-1 h-4 w-4" /> Configurar webhook na Z-API</Button>
            </div>
            {wa.last_error && <p className="text-xs text-destructive">Último erro: {wa.last_error}</p>}
            {wa.last_checked_at && <p className="text-xs text-muted-foreground">Verificado em {fmt(wa.last_checked_at, "dd/MM HH:mm", salon!.timezone)}</p>}

            <div className="space-y-1.5">
              <Label className="text-xs">URL do webhook (ao receber)</Label>
              <div className="flex gap-2">
                <Input readOnly value={showUrl ? url : masked} className="font-mono text-xs" aria-label="URL do webhook" />
                <Button variant="outline" size="icon" aria-label={showUrl ? "Esconder URL" : "Mostrar URL"} onClick={() => setShowUrl(!showUrl)}>
                  {showUrl ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
                <Button variant="outline" size="icon" aria-label="Copiar URL" onClick={copy}><Copy className="h-4 w-4" /></Button>
              </div>
              <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                Tem uma chave secreta: trate como senha. Mensagens de outra instância são recusadas.
                <button type="button" className="ml-1 font-semibold underline" onClick={async () => {
                  if (!window.confirm("Gerar uma nova chave? A URL antiga para de funcionar até você configurar a nova na Z-API.")) return;
                  try {
                    await rotate.mutateAsync();
                    toast.success("Nova chave gerada. Clique em \"Configurar webhook na Z-API\".");
                  } catch (err) {
                    toast.error(errorMessage(err));
                  }
                }}>Gerar nova chave</button>
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-test" className="text-xs">Enviar teste para</Label>
                <Input id="wa-test" placeholder="(11) 98888-7777" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} className="w-52" />
              </div>
              <Button variant="outline" onClick={() => run("test")} disabled={connect.isPending || !normalizePhone(testPhone)}><Send className="mr-1 h-4 w-4" /> Enviar teste</Button>
            </div>

            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              <span>Envios ligados<span className="block text-xs text-muted-foreground">Desligado, nada sai da fila (as mensagens recebidas continuam chegando).</span></span>
              <Switch checked={wa.active} disabled={setActive.isPending} onCheckedChange={async (v) => {
                try {
                  await setActive.mutateAsync(v);
                } catch (err) {
                  toast.error(errorMessage(err));
                }
              }} />
            </label>
          </>
        )}
      </div>

      <Dialog open={Boolean(qr)} onOpenChange={(o) => !o && setQr(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Leia com o WhatsApp do salão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">WhatsApp → Aparelhos conectados → Conectar aparelho. O código muda a cada poucos segundos.</p>
          {qr && <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code do WhatsApp" className="mx-auto w-64" />}
          <Button variant="outline" onClick={() => run("qrcode")}><RefreshCw className="mr-1 h-4 w-4" /> Gerar outro</Button>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
