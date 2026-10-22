import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

/** Salão suspenso pelo suporte: explica, deixa trocar de salão (se houver outro) ou sair. */
export function SalonSuspended() {
  const { memberships, profile, switchSalon, signOut, isPlatformAdmin } = useAuth();
  const others = memberships.filter((m) => m.salon_id !== profile?.current_salon_id && m.salon);
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6">
      <div className="max-w-md text-center">
        <Logo className="justify-center" />
        <span className="mx-auto mt-8 grid h-12 w-12 place-items-center rounded-2xl bg-muted"><Lock className="h-5 w-5" /></span>
        <h1 className="mt-4 font-display text-2xl font-light">Este salão está com o acesso suspenso</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Os dados estão guardados e nada foi apagado. Fale com o suporte do Salon OS para reativar.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {others.map((m) => (
            <Button key={m.salon_id} variant="outline" onClick={() => switchSalon(m.salon_id)}>Entrar em {m.salon?.name}</Button>
          ))}
          {isPlatformAdmin && <Button asChild variant="outline"><Link to="/painel">Painel SaaS</Link></Button>}
          <Button variant="ghost" onClick={signOut}>Sair</Button>
        </div>
      </div>
    </div>
  );
}
