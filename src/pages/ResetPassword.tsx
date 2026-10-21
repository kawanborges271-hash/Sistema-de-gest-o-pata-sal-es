import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { supabase } from "@/integrations/supabase/client";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    if (window.location.hash.includes("type=recovery")) setRecovery(true);
    return () => data.subscription.unsubscribe();
  }, []);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    setSent(true);
  };

  const update = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("A senha precisa ter pelo menos 8 caracteres");
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Senha alterada");
    navigate("/agenda", { replace: true });
  };

  if (recovery) {
    return (
      <AuthShell title="Escolha uma nova senha.">
        <form onSubmit={update} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pw">Nova senha</Label>
            <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
          </div>
          <Button type="submit" disabled={loading} className="h-11 w-full">Salvar senha</Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={sent ? "Confira seu e-mail." : "Vamos recuperar seu acesso."}
      subtitle={sent ? "Se o e-mail estiver cadastrado, você vai receber um link para criar uma nova senha." : "Informe o e-mail da sua conta."}
    >
      {!sent && (
        <form onSubmit={request} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11" />
          </div>
          <Button type="submit" disabled={loading} className="h-11 w-full">Enviar link</Button>
        </form>
      )}
      <Link to="/login" className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground">Voltar para o login</Link>
    </AuthShell>
  );
}
