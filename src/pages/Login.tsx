import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { supabase, supabaseConfigured } from "@/integrations/supabase/client";
import { pendingInvite } from "@/lib/invite";

const schema = z.object({
  email: z.string().trim().email("E-mail inválido"),
  password: z.string().min(6, "Mínimo de 6 caracteres"),
});

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/agenda";
  const [email, setEmail] = useState(new URLSearchParams(location.search).get("email") ?? "");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ email, password });
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: parsed.data.email!, password: parsed.data.password! });
    setLoading(false);
    if (error) {
      return toast.error(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos" : error.message);
    }
    const invite = pendingInvite();
    navigate(invite ? `/convite/${invite}` : from, { replace: true });
  };

  return (
    <AuthShell title="Bem-vinda de volta ao seu salão." subtitle="Entre para ver a agenda de hoje.">
      {!supabaseConfigured && (
        <p className="mb-5 rounded-xl bg-warning/10 p-3 text-sm text-warning">
          Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no arquivo .env.local.
        </p>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
            <Link to="/redefinir-senha" className="text-xs text-muted-foreground hover:text-foreground">Esqueci a senha</Link>
          </div>
          <Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
        </div>
        <Button type="submit" disabled={loading} className="h-11 w-full">
          {loading ? "Entrando…" : "Entrar"} <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted-foreground">
        Ainda não tem conta? <Link to="/cadastro" className="font-medium text-foreground underline-offset-4 hover:underline">Cadastre seu salão</Link>
      </p>
    </AuthShell>
  );
}
