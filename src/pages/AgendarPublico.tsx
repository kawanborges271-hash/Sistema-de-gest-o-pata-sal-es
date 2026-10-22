import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, CheckCircle2, Clock, MapPin, MessageCircle, Scissors, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { supabase } from "@/integrations/supabase/client";
import { errorMessage } from "@/lib/errors";
import { formatPhone, minutesLabel, money, normalizePhone } from "@/lib/format";
import { addDaysKey, fmt, isoWeekday, labelDay, todayKey } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { PublicBooking, PublicSalon, PublicSlot } from "@/lib/types";

type Step = "servicos" | "profissional" | "horario" | "dados" | "pronto";
const ANY = "qualquer";

/** Página pública /agendar/:slug. Mobile primeiro: serviço → profissional → dia e horário → nome e WhatsApp. */
export default function AgendarPublico() {
  const { slug = "" } = useParams();
  const { data: salon, isLoading, error } = useQuery({
    queryKey: ["public-salon", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_booking_salon", { p_slug: slug });
      if (error) throw error;
      return data as PublicSalon | null;
    },
    retry: false,
  });

  useEffect(() => {
    if (salon?.name) document.title = `Agendar · ${salon.name}`;
  }, [salon?.name]);

  if (isLoading) return <FullPageLoader />;
  if (error || !salon) {
    return (
      <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
        <div>
          <h1 className="font-display text-3xl font-light">Agendamento indisponível</h1>
          <p className="mt-2 text-muted-foreground">Este link não existe ou o salão pausou o agendamento online.</p>
        </div>
      </div>
    );
  }
  return <Booking salon={salon} slug={slug} />;
}

function Booking({ salon, slug }: { salon: PublicSalon; slug: string }) {
  const tz = salon.timezone;
  const [step, setStep] = useState<Step>("servicos");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [pro, setPro] = useState<string>(ANY);
  const [day, setDay] = useState<string>(todayKey(tz));
  const [slot, setSlot] = useState<PublicSlot | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", notes: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<PublicBooking | null>(null);

  const chosen = salon.services.filter((s) => serviceIds.includes(s.id));
  const duration = chosen.reduce((s, v) => s + v.duration_minutes, 0);
  const total = chosen.reduce((s, v) => s + Number(v.price), 0);
  const startsAtPrice = chosen.some((s) => s.price_is_starting);
  const pros = salon.professionals.filter((p) => serviceIds.every((id) => p.service_ids.length === 0 || p.service_ids.includes(id)));

  const days = useMemo(() => {
    const start = todayKey(tz);
    return Array.from({ length: salon.max_days + 1 }, (_, i) => addDaysKey(start, i))
      .map((d) => ({ day: d, closed: !(salon.business_hours?.[String(isoWeekday(d))]?.length) }));
  }, [salon.max_days, salon.business_hours, tz]);

  const { data: slots = [], isFetching: loadingSlots } = useQuery({
    queryKey: ["public-slots", slug, serviceIds.join(","), pro, day],
    enabled: step === "horario" && serviceIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_booking_slots", {
        p_slug: slug, p_service_ids: serviceIds, p_professional_id: pro === ANY ? null : pro, p_date: day,
      });
      if (error) throw error;
      return (data ?? []) as PublicSlot[];
    },
  });

  const book = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("public_book_appointment", {
        p_slug: slug, p_service_ids: serviceIds, p_professional_id: pro === ANY ? null : pro,
        p_starts_at: slot!.starts_at, p_name: form.name.trim(), p_phone: normalizePhone(form.phone), p_notes: form.notes.trim() || null,
      });
      if (error) throw error;
      return data as PublicBooking;
    },
    onSuccess: (b) => {
      setDone(b);
      setStep("pronto");
    },
    onError: (err) => {
      const msg = errorMessage(err);
      setFormError(msg);
      if ((err as { message?: string }).message?.startsWith("HORARIO_INDISPONIVEL")) {
        setSlot(null);
        setStep("horario");
      }
    },
  });

  const toggleService = (id: string) => {
    setServiceIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 4 ? ids : [...ids, id]));
    setSlot(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (form.name.trim().length < 2) return setFormError("Informe seu nome");
    const phone = normalizePhone(form.phone);
    if (!phone || !/^55\d{10,11}$/.test(phone)) return setFormError("Informe seu WhatsApp com DDD");
    book.mutate();
  };

  const back: Partial<Record<Step, Step>> = { profissional: "servicos", horario: "profissional", dados: "horario" };
  const categories = [...new Set(salon.services.map((s) => s.category ?? "Serviços"))];

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary px-5 pb-8 pt-7 text-primary-foreground">
        <div className="mx-auto max-w-xl">
          <div className="text-[11px] uppercase tracking-[0.2em] text-copper">Agendamento online</div>
          <h1 className="mt-2 font-display text-3xl font-light">{salon.name}</h1>
          {salon.address && <p className="mt-2 flex items-start gap-1.5 text-sm text-primary-foreground/70"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{salon.address}</p>}
          {salon.message && <p className="mt-3 text-sm text-primary-foreground/80">{salon.message}</p>}
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pb-32 pt-5">
        {step !== "pronto" && (
          <div className="mb-5 flex items-center gap-2">
            {back[step] && (
              <Button variant="ghost" size="icon" aria-label="Voltar" onClick={() => setStep(back[step]!)}><ArrowLeft className="h-5 w-5" /></Button>
            )}
            <ol className="flex flex-1 gap-1.5" aria-label="Etapas">
              {(["servicos", "profissional", "horario", "dados"] as Step[]).map((s, i, all) => (
                <li key={s} className={cn("h-1 flex-1 rounded-full", all.indexOf(step) >= i ? "bg-copper" : "bg-muted")} />
              ))}
            </ol>
          </div>
        )}

        {step === "servicos" && (
          <section>
            <h2 className="font-display text-2xl font-light">O que você quer fazer?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Pode escolher mais de um.</p>
            {salon.services.length === 0 && <p className="mt-6 text-sm text-muted-foreground">Nenhum serviço disponível online no momento.</p>}
            {categories.map((cat) => (
              <div key={cat} className="mt-5">
                <div className="label-caps mb-2">{cat}</div>
                <div className="space-y-2">
                  {salon.services.filter((s) => (s.category ?? "Serviços") === cat).map((s) => {
                    const on = serviceIds.includes(s.id);
                    return (
                      <button key={s.id} type="button" onClick={() => toggleService(s.id)} aria-pressed={on}
                        className={cn("flex w-full items-start gap-3 rounded-2xl border bg-card p-4 text-left transition",
                          on ? "border-copper ring-1 ring-copper" : "border-border hover:border-foreground/20")}>
                        <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border", on ? "border-copper bg-copper text-white" : "border-border")}>
                          {on && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{s.name}</span>
                          {s.description && <span className="mt-0.5 block text-xs text-muted-foreground">{s.description}</span>}
                          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{minutesLabel(s.duration_minutes)}</span>
                        </span>
                        <span className="shrink-0 text-sm font-medium">{s.price_is_starting ? "a partir de " : ""}{money(Number(s.price))}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}

        {step === "profissional" && (
          <section>
            <h2 className="font-display text-2xl font-light">Com quem?</h2>
            <div className="mt-4 space-y-2">
              <ProButton active={pro === ANY} onClick={() => { setPro(ANY); setSlot(null); setStep("horario"); }}
                title="Qualquer profissional" subtitle="Mostra todos os horários livres" />
              {pros.map((p) => (
                <ProButton key={p.id} active={pro === p.id} color={p.color} onClick={() => { setPro(p.id); setSlot(null); setStep("horario"); }}
                  title={p.name} subtitle={p.role_title ?? undefined} />
              ))}
            </div>
            {pros.length === 0 && <p className="mt-4 text-sm text-muted-foreground">Ninguém faz todos esses serviços juntos. Volte e escolha menos serviços.</p>}
          </section>
        )}

        {step === "horario" && (
          <section>
            <h2 className="font-display text-2xl font-light">Quando?</h2>
            <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-2">
              <div className="flex gap-2">
                {days.map((d) => (
                  <button key={d.day} type="button" onClick={() => { setDay(d.day); setSlot(null); }}
                    className={cn("flex w-16 shrink-0 flex-col items-center rounded-2xl border px-2 py-2.5 text-center transition",
                      d.day === day ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                      d.closed && d.day !== day && "opacity-40")}>
                    <span className="text-[11px] uppercase">{labelDay(d.day, "EEE").replace(".", "")}</span>
                    <span className="font-display text-xl">{labelDay(d.day, "d")}</span>
                    <span className="text-[10px]">{labelDay(d.day, "MMM").replace(".", "")}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-3 text-sm capitalize text-muted-foreground">{labelDay(day)}</p>
            {formError && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {slots.map((s) => {
                const on = slot?.starts_at === s.starts_at && slot.professional_id === s.professional_id;
                return (
                  <button key={`${s.starts_at}-${s.professional_id}`} type="button"
                    onClick={() => { setSlot(s); setFormError(null); setStep("dados"); }}
                    className={cn("rounded-xl border px-2 py-2.5 text-sm font-medium tabular-nums transition",
                      on ? "border-copper bg-copper text-white" : "border-border bg-card hover:border-foreground/30")}>
                    {fmt(s.starts_at, "HH:mm", tz)}
                    {pro !== ANY ? null : <span className="block truncate text-[10px] font-normal opacity-70">{s.professional_name.split(" ")[0]}</span>}
                  </button>
                );
              })}
            </div>
            {!loadingSlots && slots.length === 0 && (
              <p className="mt-4 rounded-2xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                Nenhum horário livre neste dia. Tente outro dia{pro !== ANY ? " ou qualquer profissional" : ""}.
              </p>
            )}
            {loadingSlots && <p className="mt-4 text-sm text-muted-foreground">Procurando horários…</p>}
          </section>
        )}

        {step === "dados" && slot && (
          <form onSubmit={submit}>
            <h2 className="font-display text-2xl font-light">Quase lá.</h2>
            <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm">
              <div className="font-medium">{chosen.map((s) => s.name).join(" + ")}</div>
              <div className="mt-1 capitalize text-muted-foreground">{labelDay(fmt(slot.starts_at, "yyyy-MM-dd", tz))} · {fmt(slot.starts_at, "HH:mm", tz)}</div>
              <div className="text-muted-foreground">com {slot.professional_name}</div>
            </div>
            <div className="mt-5 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="pb-name">Seu nome</Label>
                <Input id="pb-name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pb-phone">WhatsApp com DDD</Label>
                <Input id="pb-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="(11) 98888-7777" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                <p className="text-xs text-muted-foreground">A confirmação chega por aqui.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pb-notes">Observação (opcional)</Label>
                <Textarea id="pb-notes" rows={2} maxLength={300} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
              {formError && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
              <Button type="submit" size="lg" className="w-full" disabled={book.isPending}>{book.isPending ? "Reservando…" : "Confirmar agendamento"}</Button>
            </div>
          </form>
        )}

        {step === "pronto" && done && (
          <section className="pt-6 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
            <h2 className="mt-4 font-display text-3xl font-light">Horário reservado!</h2>
            <p className="mt-2 text-muted-foreground">Você vai receber a confirmação no WhatsApp {formatPhone(normalizePhone(form.phone))}.</p>
            <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-border bg-card p-5 text-left text-sm">
              <div className="flex items-center gap-2 font-medium"><Scissors className="h-4 w-4 text-copper" />{done.services}</div>
              <div className="mt-2 flex items-center gap-2 capitalize"><Clock className="h-4 w-4 text-copper" />{labelDay(fmt(done.starts_at, "yyyy-MM-dd", tz))} às {fmt(done.starts_at, "HH:mm", tz)}</div>
              <div className="mt-2 flex items-center gap-2"><UserRound className="h-4 w-4 text-copper" />{done.professional_name}</div>
              <div className="mt-3 border-t border-border pt-3 text-muted-foreground">{startsAtPrice ? "A partir de " : "Valor: "}{money(Number(done.total))}</div>
            </div>
            {salon.whatsapp && (
              <a href={`https://wa.me/${salon.whatsapp}`} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-success hover:underline">
                <MessageCircle className="h-4 w-4" /> Falar com o salão
              </a>
            )}
          </section>
        )}
      </main>

      {step === "servicos" && serviceIds.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-xl items-center gap-3">
            <div className="flex-1 text-sm">
              <div className="font-medium">{serviceIds.length} {serviceIds.length === 1 ? "serviço" : "serviços"} · {minutesLabel(duration)}</div>
              <div className="text-muted-foreground">{startsAtPrice ? "a partir de " : ""}{money(total)}</div>
            </div>
            <Button size="lg" onClick={() => setStep("profissional")}>Continuar</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProButton({ active, onClick, title, subtitle, color }: { active: boolean; onClick: () => void; title: string; subtitle?: string; color?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn("flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left transition", active ? "border-copper ring-1 ring-copper" : "border-border hover:border-foreground/20")}>
      <span className="grid h-10 w-10 place-items-center rounded-full bg-muted" style={color ? { backgroundColor: `${color}22`, color } : undefined}>
        <UserRound className="h-5 w-5" />
      </span>
      <span className="flex-1">
        <span className="block font-medium">{title}</span>
        {subtitle && <span className="block text-xs text-muted-foreground">{subtitle}</span>}
      </span>
    </button>
  );
}
