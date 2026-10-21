import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { ptBR } from "date-fns/locale";

/**
 * Datas sempre no fuso do salão. O banco guarda timestamptz (UTC);
 * a tela trabalha com "hora de parede" do salão.
 */
export const DEFAULT_TZ = "America/Sao_Paulo";

/** Formata um instante no fuso do salão (padrões do date-fns). */
export function fmt(date: string | Date, pattern: string, tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(date, tz, pattern, { locale: ptBR });
}

export const fmtDate = (d: string | Date, tz?: string) => fmt(d, "dd/MM/yyyy", tz);
export const fmtTime = (d: string | Date, tz?: string) => fmt(d, "HH:mm", tz);
export const fmtDateTime = (d: string | Date, tz?: string) => fmt(d, "dd/MM/yyyy HH:mm", tz);

/** "2026-10-21" + "14:30" no fuso do salão → instante UTC. */
export function zonedToUtc(day: string, time: string, tz: string = DEFAULT_TZ): Date {
  return fromZonedTime(`${day}T${time}:00`, tz);
}

/** Dia (yyyy-MM-dd) de um instante no fuso do salão. */
export function dayKey(date: string | Date, tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(date, tz, "yyyy-MM-dd");
}

/** Minutos desde 00:00 no fuso do salão. */
export function minutesOfDay(date: string | Date, tz: string = DEFAULT_TZ): number {
  const z = toZonedTime(date, tz);
  return z.getHours() * 60 + z.getMinutes();
}

export function todayKey(tz: string = DEFAULT_TZ): string {
  return dayKey(new Date(), tz);
}

/** Soma dias a uma chave yyyy-MM-dd (aritmética de calendário, sem fuso). */
export function addDaysKey(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

/** Dia da semana ISO (1 = segunda ... 7 = domingo) de uma chave yyyy-MM-dd. */
export function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Segunda-feira da semana da chave. */
export function startOfWeekKey(day: string): string {
  return addDaysKey(day, 1 - isoWeekday(day));
}

export function labelDay(day: string, pattern = "EEEE, d 'de' MMMM"): string {
  return formatInTimeZone(`${day}T12:00:00Z`, "UTC", pattern, { locale: ptBR });
}

export function hhmmToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export const WEEKDAYS = [
  { iso: 1, short: "Seg", long: "Segunda" },
  { iso: 2, short: "Ter", long: "Terça" },
  { iso: 3, short: "Qua", long: "Quarta" },
  { iso: 4, short: "Qui", long: "Quinta" },
  { iso: 5, short: "Sex", long: "Sexta" },
  { iso: 6, short: "Sáb", long: "Sábado" },
  { iso: 7, short: "Dom", long: "Domingo" },
];
