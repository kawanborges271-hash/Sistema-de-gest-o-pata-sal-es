import { useEffect, useState, useSyncExternalStore } from "react";
import { Smartphone } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// O Chrome avisa uma vez que o app pode ser instalado; guardamos o aviso para usar no clique.
let deferred: InstallPrompt | null = null;
let dialogOpen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPrompt;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

const setDialog = (open: boolean) => {
  dialogOpen = open;
  emit();
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** Item do menu do usuário. Some quando o sistema já está aberto como app. */
export function InstallAppItem() {
  const [standalone] = useState(isStandalone);
  if (standalone) return null;
  return (
    <DropdownMenuItem
      onClick={async () => {
        if (deferred) {
          await deferred.prompt();
          deferred = null;
          emit();
        } else {
          setDialog(true);
        }
      }}
    >
      <Smartphone className="mr-2 h-4 w-4" /> Atalho no celular
    </DropdownMenuItem>
  );
}

/** Passo a passo para quem não recebe o botão automático (iPhone e alguns Android). */
export function InstallAppDialog() {
  const open = useSyncExternalStore(subscribe, () => dialogOpen);
  const [ios, setIos] = useState(false);
  useEffect(() => setIos(/iphone|ipad|ipod/i.test(navigator.userAgent)), []);
  const url = `${window.location.origin}/agenda`;

  return (
    <Dialog open={open} onOpenChange={setDialog}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Atalho do Salon OS no celular</DialogTitle>
          <DialogDescription>
            O atalho fica na tela inicial e abre o sistema direto na agenda, em tela cheia. Nada é baixado: é o mesmo site. Abra {url} no celular e siga:
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section className={ios ? "order-first" : undefined}>
            <h3 className="mb-1 font-medium">iPhone (Safari)</h3>
            <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
              <li>Toque no botão de compartilhar (o quadrado com a seta para cima).</li>
              <li>Escolha <strong className="text-foreground">Adicionar à Tela de Início</strong>.</li>
              <li>Toque em <strong className="text-foreground">Adicionar</strong>.</li>
            </ol>
          </section>
          <section>
            <h3 className="mb-1 font-medium">Android (Chrome)</h3>
            <ol className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
              <li>Toque nos três pontinhos no canto de cima.</li>
              <li>Escolha <strong className="text-foreground">Adicionar à tela inicial</strong> (em alguns aparelhos aparece como "Instalar app").</li>
              <li>Confirme.</li>
            </ol>
          </section>
          <p className="text-xs text-muted-foreground">
            Cada pessoa da equipe cria o atalho no próprio celular e entra com o seu login. Ela vê só o que o papel dela permite.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
