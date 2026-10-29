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
    <div className="mb-6 flex flex-col gap-4 md:mb-8 md:gap-5 md:flex-row md:items-end md:justify-between">
      <div>
        <div className="label-caps">{eyebrow}</div>
        <h1 className="mt-2 max-w-2xl md:mt-3 text-balance font-display text-2xl font-light leading-[1.08] md:text-[44px]">{title}</h1>
        {/* No celular o subtítulo some: a tela fica para o que se usa. */}
        {subtitle && <p className="mt-3 hidden max-w-xl sm:block text-[15px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
