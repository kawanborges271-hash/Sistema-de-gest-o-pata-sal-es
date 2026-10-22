import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Check, Copy, Plus, Sparkles, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Logo } from "@/components/brand/Logo";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { BusinessHoursEditor, DEFAULT_BUSINESS_HOURS } from "@/components/salao/BusinessHoursEditor";
import { SalonInfoFields, salonInfoFrom, type SalonInfo } from "@/components/salao/SalonInfoFields";
import { useAuth } from "@/contexts/AuthContext";
import { useInvite } from "@/hooks/useTeam";
import { supabase } from "@/integrations/supabase/client";
import { ROLE_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { normalizePhone } from "@/lib/format";
import { pendingInvite } from "@/lib/invite";
import { cn } from "@/lib/utils";
import type { BusinessHours, SalonRole } from "@/lib/types";

const STEPS = ["Salão", "Contato e endereço", "Horário", "Equipe", "Começar"];

export default function Onboarding() {
  const { salon, role, loading, refresh, profile, salonBlocked, isPlatformAdmin, memberships } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [info, setInfo] = useState<SalonInfo>(salonInfoFrom(null));
  const [hours, setHours] = useState<BusinessHours>(DEFAULT_BUSINESS_HOURS);
  const [busy, setBusy] = useState(false);
  const [invites, setInvites] = useState<{ email: string; role: SalonRole; link?: string; emailed?: boolean }[]>([]);
  const [draft, setDraft] = useState({ email: "", role: "profissional" as SalonRole });
  const invite = useInvite();

  useEffect(() => {
    if (salon) {
      setInfo(salonInfoFrom(salon));
      if (Object.keys(salon.business_hours ?? {}).length) setHours(salon.business_hours);
      setStep((s) => (s === 0 ? 1 : s));
    }
  }, [salon]);

  if (loading) return <FullPageLoader />;
  const token = pendingInvite();
  // salão suspenso: a tela de suspensão (em RequireSalon) explica o que fazer
  if (!salon && salonBlocked) return <Navigate to="/agenda" replace />;
  if (!salon && token) return <Navigate to={`/convite/${token}`} replace />;
  // super admin sem salão não passa pelo onboarding: vai direto ao Painel SaaS
  if (!salon && isPlatformAdmin && memberships.length === 0) return <Navigate to="/painel" replace />;
  if (salon && (salon.onboarding_completed || role !== "admin")) return <Navigate to="/agenda" replace />;

  const createSalon = async () => {
    if (name.trim().length < 2) return toast.error("Dê um nome ao salão");
    setBusy(true);
    const { error } = await supabase.rpc("create_salon", { p_name: name.trim() });
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    setStep(1);
  };

  const saveSalon = async (patch: Record<string, unknown>, next: number) => {
    setBusy(true);
    const { error } = await supabase.from("salons").update(patch).eq("id", salon!.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    setStep(next);
  };

  const addInvite = async () => {
    const email = draft.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast.error("E-mail inválido");
    try {
      const r = await invite.mutateAsync({ email, role: draft.role });
      setInvites((l) => [...l, { email, role: draft.role, link: r.link, emailed: r.emailed }]);
      setDraft({ ...draft, email: "" });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const finish = async (demo: boolean) => {
    setBusy(true);
    if (demo) {
      const { error } = await supabase.rpc("seed_demo_salon", { p_salon_id: salon!.id });
      if (error) {
        setBusy(false);
        return toast.error(errorMessage(error));
      }
    }
    const { error } = await supabase.from("salons").update({ onboarding_completed: true }).eq("id", salon!.id);
    setBusy(false);
    if (error) return toast.error(errorMessage(error));
    await refresh();
    toast.success(demo ? "Salão de demonstração pronto" : "Tudo pronto! Comece pelos serviços.");
    navigate(demo ? "/agenda" : "/servicos", { replace: true });
  };

  return (
    <div className="min-h-screen bg-background px-4 py-8 md:px-8">
      <div className="mx-auto max-w-2xl">
        <Logo />
        <div className="mt-8 flex gap-1.5">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={cn("h-1 rounded-full", i <= step ? "bg-copper" : "bg-border")} />
              <div className={cn("mt-2 hidden text-[11px] sm:block", i === step ? "text-foreground" : "text-muted-foreground")}>{s}</div>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-3xl border border-border bg-card p-6 shadow-soft md:p-8">
          {step === 0 && (
            <>
              <h1 className="font-display text-3xl font-light">Olá{profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}. Como se chama seu salão?</h1>
              <p className="mt-2 text-muted-foreground">É o nome que as clientes vão ver nas mensagens e no link de agendamento.</p>
              <div className="mt-6 space-y-2">
                <Label>Nome do salão</Label>
                <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && createSalon()} placeholder="Ex.: Studio Bela Flor" className="h-11" />
              </div>
              <Button className="mt-6" onClick={createSalon} disabled={busy}>Continuar</Button>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="font-display text-3xl font-light">Onde fica e como falar com vocês.</h1>
              <p className="mt-2 text-muted-foreground">O WhatsApp do salão será usado nas confirmações automáticas (Fase 3).</p>
              <div className="mt-6"><SalonInfoFields value={info} onChange={setInfo} /></div>
              <div className="mt-6 flex gap-2">
                <Button onClick={() => saveSalon({ ...info, whatsapp: info.whatsapp ? normalizePhone(info.whatsapp) : null, name: info.name.trim() || salon!.name }, 2)} disabled={busy}>Continuar</Button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="font-display text-3xl font-light">Quando o salão está aberto?</h1>
              <p className="mt-2 text-muted-foreground">Serve de base para a agenda. A jornada de cada profissional você ajusta depois.</p>
              <div className="mt-6"><BusinessHoursEditor value={hours} onChange={setHours} /></div>
              <div className="mt-6 flex gap-2">
                <Button variant="ghost" onClick={() => setStep(1)}>Voltar</Button>
                <Button onClick={() => saveSalon({ business_hours: hours }, 3)} disabled={busy}>Continuar</Button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="font-display text-3xl font-light">Chame sua equipe.</h1>
              <p className="mt-2 text-muted-foreground">Cada pessoa recebe um convite por e-mail que vale 7 dias. Dá para fazer isso depois em Equipe.</p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row">
                <Input placeholder="email@exemplo.com" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addInvite()} />
                <Select value={draft.role} onValueChange={(v) => setDraft({ ...draft, role: v as SalonRole })}>
                  <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>{(["recepcao", "profissional", "admin"] as SalonRole[]).map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                </Select>
                <Button onClick={addInvite} disabled={invite.isPending}><Plus className="mr-1 h-4 w-4" /> Convidar</Button>
              </div>
              <div className="mt-4 space-y-2">
                {invites.map((i) => (
                  <div key={i.email} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm">
                    <Check className="h-4 w-4 text-success" />
                    <span className="flex-1">{i.email} · {ROLE_LABEL[i.role]}</span>
                    {!i.emailed && i.link && (
                      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(i.link!); toast.success("Link copiado"); }}>
                        <Copy className="mr-1 h-3.5 w-3.5" /> Copiar link
                      </Button>
                    )}
                    <button aria-label="Remover da lista" onClick={() => setInvites((l) => l.filter((x) => x.email !== i.email))}><X className="h-4 w-4 text-muted-foreground" /></button>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex gap-2">
                <Button variant="ghost" onClick={() => setStep(2)}>Voltar</Button>
                <Button onClick={() => setStep(4)}>{invites.length ? "Continuar" : "Pular por agora"}</Button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h1 className="font-display text-3xl font-light">Como você quer começar?</h1>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                <button disabled={busy} onClick={() => finish(true)} className="rounded-2xl border border-border p-5 text-left transition hover:border-copper hover:shadow-elev disabled:opacity-60">
                  <Sparkles className="h-5 w-5 text-copper" />
                  <div className="mt-3 font-medium">Explorar com dados de exemplo</div>
                  <p className="mt-1 text-sm text-muted-foreground">3 profissionais, 15 serviços, 30 clientes e 6 semanas de agenda para ver tudo funcionando.</p>
                </button>
                <button disabled={busy} onClick={() => finish(false)} className="rounded-2xl border border-border p-5 text-left transition hover:border-copper hover:shadow-elev disabled:opacity-60">
                  <Wand2 className="h-5 w-5 text-copper" />
                  <div className="mt-3 font-medium">Começar do zero</div>
                  <p className="mt-1 text-sm text-muted-foreground">Cadastre seus serviços e profissionais e comece a agendar.</p>
                </button>
              </div>
              {busy && <p className="mt-4 text-sm text-muted-foreground">Preparando o salão…</p>}
              <Button variant="ghost" className="mt-4" onClick={() => setStep(3)}>Voltar</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
