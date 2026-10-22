import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { supabase } from "@/integrations/supabase/client";
import { pendingInvite } from "@/lib/invite";

const schema = z.object({
  full_name: z.string().trim().min(2, "Informe seu nome"),
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

export default function Signup() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const [form, setForm] = useState({ full_name: "", email: params.get("email") ?? "", password: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const invite = pendingInvite();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setLoading(true);
    const next = invite ? `/convite/${invite}` : "/onboarding";
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: { data: { full_name: parsed.data.full_name }, emailRedirectTo: `${window.location.origin}${next}` },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    if (data.session) navigate(next, { replace: true });
    else setSent(true);
  };

  if (sent) {
    return (
      <AuthShell title="Confira seu e-mail." subtitle={`Enviamos um link de confirmação para ${form.email}. Abra o link para continuar.`}>
        <Link to="/login" className="text-sm font-medium underline-offset-4 hover:underline">Voltar para o login</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={invite ? "Crie sua conta para entrar na equipe." : "Seu salão organizado em 5 minutos."}
      subtitle={invite ? "Use o mesmo e-mail que recebeu o convite." : "Crie sua conta; depois você cadastra o salão, os serviços e a equipe."}
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Seu nome</Label>
          <Input id="name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-11" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Senha</Label>
          <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-11" />
        </div>
        <Button type="submit" disabled={loading} className="h-11 w-full">{loading ? "Criando…" : "Criar conta"}</Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Já tem conta? <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">Entrar</Link>
      </p>
    </AuthShell>
  );
}
