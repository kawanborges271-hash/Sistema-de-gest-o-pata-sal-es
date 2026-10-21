import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/AuthShell";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ROLE_LABEL } from "@/lib/agenda";
import { clearInvite, rememberInvite } from "@/lib/invite";
import { errorMessage } from "@/lib/errors";
import type { SalonRole } from "@/lib/types";

type Preview = { salon_name: string; email: string; role: SalonRole; expired: boolean; used: boolean };

export default function Convite() {
  const { token = "" } = useParams();
  const { user, loading, refresh, signOut } = useAuth();
  const navigate = useNavigate();
  const [accepting, setAccepting] = useState(false);
  const [password, setPassword] = useState("");
  // Quem chega pelo e-mail de convite do Auth entra sem senha; pedimos uma aqui.
  const needsPassword = Boolean(user?.invited_at) && user?.last_sign_in_at === user?.invited_at;

  useEffect(() => rememberInvite(token), [token]);

  const { data: invite, isLoading } = useQuery({
    queryKey: ["invite", token],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("invitation_preview", { p_token: token });
      if (error) throw error;
      return ((data as Preview[]) ?? [])[0] ?? null;
    },
  });

  const accept = async () => {
    if (needsPassword && password.length < 8) return toast.error("Crie uma senha com pelo menos 8 caracteres");
    setAccepting(true);
    if (password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setAccepting(false);
        return toast.error(error.message);
      }
    }
    const { error } = await supabase.rpc("accept_invitation", { p_token: token });
    setAccepting(false);
    if (error) return toast.error(errorMessage(error));
    clearInvite();
    await refresh();
    toast.success(`Bem-vinda à equipe do ${invite?.salon_name}!`);
    navigate("/agenda", { replace: true });
  };

  if (loading || isLoading) return <FullPageLoader />;

  if (!invite) {
    return (
      <AuthShell title="Convite não encontrado." subtitle="Confira o link ou peça um novo convite ao salão.">
        <Link to="/login" className="text-sm underline-offset-4 hover:underline">Ir para o login</Link>
      </AuthShell>
    );
  }
  if (invite.expired || invite.used) {
    clearInvite();
    return (
      <AuthShell
        title={invite.used ? "Este convite já foi usado." : "Este convite expirou."}
        subtitle="Convites valem por 7 dias. Peça um novo ao administrador do salão."
      >
        <Link to="/login" className="text-sm underline-offset-4 hover:underline">Ir para o login</Link>
      </AuthShell>
    );
  }

  const sameEmail = user?.email?.toLowerCase() === invite.email;

  return (
    <AuthShell
      title={`Você foi convidada para o ${invite.salon_name}.`}
      subtitle={`Papel: ${ROLE_LABEL[invite.role]}. Convite enviado para ${invite.email}.`}
    >
      {!user && (
        <div className="space-y-3">
          <Button asChild className="h-11 w-full">
            <Link to={`/cadastro?email=${encodeURIComponent(invite.email)}`}>Criar minha conta</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 w-full">
            <Link to={`/login?email=${encodeURIComponent(invite.email)}`}>Já tenho conta</Link>
          </Button>
        </div>
      )}
      {user && sameEmail && (
        <div className="space-y-4">
          {needsPassword && (
            <div className="space-y-2">
              <Label htmlFor="pw">Crie sua senha</Label>
              <Input id="pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-11" />
            </div>
          )}
          <Button onClick={accept} disabled={accepting} className="h-11 w-full">
            {accepting ? "Entrando…" : "Aceitar convite"}
          </Button>
        </div>
      )}
      {user && !sameEmail && (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Você está logada como {user.email}. Saia e entre com {invite.email} para aceitar.</p>
          <Button variant="outline" onClick={signOut} className="h-11 w-full">Sair desta conta</Button>
        </div>
      )}
    </AuthShell>
  );
}
