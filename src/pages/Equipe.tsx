import { useState } from "react";
import { toast } from "sonner";
import { Copy, MailPlus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/common/PageHeader";
import { SectionCard } from "@/components/common/SectionCard";
import { useAuth } from "@/contexts/AuthContext";
import { useInvitations, useInvite, useMembers, useRevokeInvite, useUpdateMember } from "@/hooks/useTeam";
import { ROLE_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { initials } from "@/lib/format";
import { fmtDate } from "@/lib/tz";
import type { SalonRole } from "@/lib/types";

const ROLE_HINT: Record<SalonRole, string> = {
  admin: "Tudo, inclusive financeiro, equipe e configurações.",
  recepcao: "Agenda, clientes e (na Fase 2) comandas e caixa. Sem relatórios financeiros nem comissões dos outros.",
  profissional: "Só a própria agenda, os clientes que atendeu e (na Fase 2) a própria comissão.",
};

export default function Equipe() {
  const { user, salon } = useAuth();
  const tz = salon!.timezone;
  const { data: members = [] } = useMembers();
  const { data: invitations = [] } = useInvitations();
  const invite = useInvite();
  const revoke = useRevokeInvite();
  const update = useUpdateMember();
  const [form, setForm] = useState({ email: "", full_name: "", role: "profissional" as SalonRole });
  const [lastLink, setLastLink] = useState<string | null>(null);

  const send = async () => {
    const email = form.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast.error("E-mail inválido");
    try {
      const r = await invite.mutateAsync({ email, role: form.role, full_name: form.full_name.trim() || undefined });
      if (r.emailed) {
        toast.success(`Convite enviado para ${email}`);
        setLastLink(null);
      } else {
        toast.message("Essa pessoa já tem conta. Envie o link do convite pelo WhatsApp.");
        setLastLink(r.link);
      }
      setForm({ ...form, email: "", full_name: "" });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const copy = (link: string) => {
    navigator.clipboard.writeText(link);
    toast.success("Link copiado");
  };

  const change = async (id: string, patch: { role?: SalonRole; active?: boolean }) => {
    try {
      await update.mutateAsync({ id, ...patch });
      toast.success("Acesso atualizado");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <PageHeader eyebrow="Gestão · Equipe" title="Quem acessa o sistema e o que cada um vê."
        subtitle="As permissões valem no banco de dados, não só no menu: um profissional não consegue ver a agenda dos colegas nem por fora da tela." />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <SectionCard title="Membros" hint={`${members.filter((m) => m.active).length} com acesso ativo`}>
            <div className="divide-y divide-border">
              {members.map((m) => {
                const self = m.user_id === user?.id;
                return (
                  <div key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(m.profile?.full_name || m.profile?.email)}</span>
                    <div className="min-w-[160px] flex-1">
                      <div className="text-sm font-medium">{m.profile?.full_name || m.profile?.email}{self && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}</div>
                      <div className="text-xs text-muted-foreground">{m.profile?.email} · desde {fmtDate(m.created_at, tz)}</div>
                    </div>
                    <Select value={m.role} onValueChange={(v) => change(m.id, { role: v as SalonRole })} disabled={self}>
                      <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                      <SelectContent>{(Object.keys(ROLE_LABEL) as SalonRole[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch checked={m.active} disabled={self} onCheckedChange={(v) => change(m.id, { active: v })} /> {m.active ? "Ativo" : "Sem acesso"}
                    </label>
                  </div>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Convites pendentes" hint="Valem 7 dias a partir do envio.">
            {invitations.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum convite aguardando.</p>
            ) : (
              <div className="divide-y divide-border">
                {invitations.map((i) => {
                  const expired = new Date(i.expires_at) < new Date();
                  const link = `${window.location.origin}/convite/${i.token}`;
                  return (
                    <div key={i.id} className="flex flex-wrap items-center gap-2 py-3 text-sm">
                      <div className="min-w-[180px] flex-1">
                        <div className="font-medium">{i.email}</div>
                        <div className="text-xs text-muted-foreground">{ROLE_LABEL[i.role]} · {expired ? "expirou" : `vale até ${fmtDate(i.expires_at, tz)}`}</div>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => copy(link)}><Copy className="mr-1 h-3.5 w-3.5" /> Link</Button>
                      <Button size="sm" variant="ghost" onClick={() => invite.mutate({ resend: i.id }, { onSuccess: () => toast.success("Convite reenviado"), onError: (e) => toast.error(errorMessage(e)) })}>
                        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reenviar
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revoke.mutate(i.id)}><X className="mr-1 h-3.5 w-3.5" /> Cancelar</Button>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Convidar pessoa">
            <div className="space-y-3">
              <Input placeholder="Nome (opcional)" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
              <Input placeholder="email@exemplo.com" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as SalonRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(ROLE_LABEL) as SalonRole[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_HINT[form.role]}</p>
              <Button className="w-full" onClick={send} disabled={invite.isPending}><MailPlus className="mr-1 h-4 w-4" /> {invite.isPending ? "Enviando…" : "Enviar convite"}</Button>
              {lastLink && (
                <Button variant="outline" className="w-full" onClick={() => copy(lastLink)}><Copy className="mr-1 h-4 w-4" /> Copiar link do convite</Button>
              )}
            </div>
          </SectionCard>
          <SectionCard title="Papéis">
            <div className="space-y-3 text-sm">
              {(Object.keys(ROLE_LABEL) as SalonRole[]).map((r) => (
                <div key={r} className="flex gap-2">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-copper" />
                  <div><b>{ROLE_LABEL[r]}</b><div className="text-muted-foreground">{ROLE_HINT[r]}</div></div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
