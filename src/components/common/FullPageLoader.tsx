export function FullPageLoader({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="animate-pulse text-sm text-muted-foreground">{label}</div>
    </div>
  );
}
