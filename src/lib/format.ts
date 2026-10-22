const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const int = new Intl.NumberFormat("pt-BR");

/** Valor sem dado aparece como "—", nunca como zero. */
export const EMPTY = "—";

export function money(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? EMPTY : brl.format(v);
}

export function num(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? EMPTY : int.format(v);
}

export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

/** Normaliza telefone brasileiro para só dígitos com DDI 55. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function formatPhone(p: string | null | undefined): string {
  if (!p) return EMPTY;
  const d = p.replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return p;
}

export function initials(name: string | null | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias", "há 3 sem." */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return EMPTY;
  const min = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 14) return `há ${d} ${d === 1 ? "dia" : "dias"}`;
  if (d < 60) return `há ${Math.round(d / 7)} sem.`;
  return `há ${Math.round(d / 30)} meses`;
}
