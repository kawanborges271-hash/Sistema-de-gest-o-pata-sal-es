import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}

/** Cabeçalho editorial: título humano + subtítulo que explica a tela. */
export function PageHeader({ eyebrow, title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="label-caps">{eyebrow}</div>
        <h1 className="mt-3 max-w-2xl text-balance font-display text-3xl font-light leading-[1.08] md:text-[44px]">{title}</h1>
        {subtitle && <p className="mt-3 max-w-xl text-[15px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
