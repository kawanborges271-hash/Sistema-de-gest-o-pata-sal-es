import type { ReactNode } from "react";
import { Logo } from "@/components/brand/Logo";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-14">
        <Logo />
        <div className="flex flex-1 items-center">
          <div className="mx-auto w-full max-w-sm">
            <h1 className="text-balance font-display text-3xl font-light leading-[1.08] sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-3 text-[15px] text-muted-foreground">{subtitle}</p>}
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-primary p-14 text-primary-foreground lg:flex lg:flex-col lg:justify-end">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-copper/25 blur-3xl" />
        <div className="relative max-w-md">
          <div className="text-[11px] uppercase tracking-[0.2em] text-copper">Salon OS</div>
          <p className="mt-4 font-display text-4xl font-light leading-tight">
            Agenda cheia, cliente que volta e caixa que fecha.
          </p>
          <p className="mt-4 text-primary-foreground/60">
            Agenda por profissional, ficha técnica, lembretes no WhatsApp e números que mostram onde o salão fatura.
          </p>
        </div>
      </div>
    </div>
  );
}
