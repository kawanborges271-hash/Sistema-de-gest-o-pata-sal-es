import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  useCategories, useProfessionalHours, useProfessionalServices, useSaveProfessional, useServices,
} from "@/hooks/useCatalog";
import { useMembers } from "@/hooks/useTeam";
import { PROFESSIONAL_COLORS } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { WEEKDAYS } from "@/lib/tz";
import { cn } from "@/lib/utils";
import type { Professional } from "@/lib/types";

type Range = { start_time: string; end_time: string };
type Override = { price: number | null; duration_minutes: number | null; commission_pct: number | null };

const DEFAULT_WEEK: Record<number, Range[]> = Object.fromEntries(
  WEEKDAYS.map((d) => [d.iso, d.iso >= 2 && d.iso <= 6 ? [{ start_time: "09:00", end_time: "12:00" }, { start_time: "13:00", end_time: "19:00" }] : []]),
);

export function ProfessionalDialog({ open, onOpenChange, professional }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  professional?: Professional | null;
}) {
  const { data: services = [] } = useServices();
  const { data: categories = [] } = useCategories();
  const { data: allPs = [] } = useProfessionalServices();
  const { data: allHours = [] } = useProfessionalHours();
  const { data: members = [] } = useMembers();
  const save = useSaveProfessional();

  const [form, setForm] = useState({
    name: "", role_title: "", phone: "", email: "", color: PROFESSIONAL_COLORS[0],
    default_commission_pct: 0, active: true, user_id: null as string | null,
  });
  const [selected, setSelected] = useState<Record<string, Override>>({});
  const [week, setWeek] = useState<Record<number, Range[]>>(DEFAULT_WEEK);

  useEffect(() => {
    if (!open) return;
    if (professional) {
      setForm({
        name: professional.name, role_title: professional.role_title ?? "", phone: professional.phone ?? "",
        email: professional.email ?? "", color: professional.color,
        default_commission_pct: Number(professional.default_commission_pct ?? 0), active: professional.active, user_id: professional.user_id,
      });
      setSelected(Object.fromEntries(
        allPs.filter((p) => p.professional_id === professional.id)
          .map((p) => [p.service_id, { price: p.price, duration_minutes: p.duration_minutes, commission_pct: p.commission_pct }]),
      ));
      const hours = allHours.filter((h) => h.professional_id === professional.id);
      setWeek(Object.fromEntries(WEEKDAYS.map((d) => [d.iso, hours.filter((h) => h.weekday === d.iso)
        .map((h) => ({ start_time: h.start_time.slice(0, 5), end_time: h.end_time.slice(0, 5) }))])));
    } else {
      setForm({ name: "", role_title: "", phone: "", email: "", color: PROFESSIONAL_COLORS[Math.floor(Math.random() * PROFESSIONAL_COLORS.length)], default_commission_pct: 0, active: true, user_id: null });
      setSelected({});
      setWeek(DEFAULT_WEEK);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, professional]);

  const activeServices = useMemo(() => services.filter((s) => s.active || selected[s.id]), [services, selected]);
  const linkable = members.filter((m) => m.role === "profissional" || m.user_id === form.user_id);

  const toggleService = (id: string, on: boolean) =>
    setSelected((s) => {
      const next = { ...s };
      if (on) next[id] = { price: null, duration_minutes: null, commission_pct: null };
      else delete next[id];
      return next;
    });

  const setRange = (day: number, i: number, patch: Partial<Range>) =>
    setWeek((w) => ({ ...w, [day]: w[day].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  const submit = async () => {
    if (!form.name.trim()) return toast.error("Informe o nome");
    for (const d of WEEKDAYS) {
      const ranges = [...week[d.iso]].sort((a, b) => a.start_time.localeCompare(b.start_time));
      for (let i = 0; i < ranges.length; i++) {
        if (ranges[i].end_time <= ranges[i].start_time) return toast.error(`${d.long}: o fim precisa ser depois do início`);
        if (i > 0 && ranges[i].start_time < ranges[i - 1].end_time) return toast.error(`${d.long}: faixas se sobrepõem`);
      }
    }
    try {
      await save.mutateAsync({
        ...(professional ? { id: professional.id } : {}),
        ...form,
        name: form.name.trim(),
        role_title: form.role_title.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        services: Object.entries(selected).map(([service_id, o]) => ({ service_id, ...o })),
        hours: WEEKDAYS.flatMap((d) => week[d.iso].map((r) => ({ weekday: d.iso, ...r }))),
      });
      toast.success(professional ? "Profissional atualizado" : "Profissional cadastrado");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display font-medium">{professional ? professional.name : "Novo profissional"}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="dados">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="servicos">Serviços ({Object.keys(selected).length})</TabsTrigger>
            <TabsTrigger value="jornada">Jornada</TabsTrigger>
          </TabsList>

          <TabsContent value="dados" className="space-y-4 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2"><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="space-y-2"><Label>Cargo</Label><Input placeholder="Cabeleireira, manicure…" value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} /></div>
              <div className="space-y-2"><Label>Telefone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div className="space-y-2"><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              <div className="space-y-2">
                <Label>Comissão padrão (%)</Label>
                <Input type="number" min={0} max={100} step="0.5" value={form.default_commission_pct} onChange={(e) => setForm({ ...form, default_commission_pct: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground">Usada quando o serviço não tem comissão própria para este profissional.</p>
              </div>
              <div className="space-y-2">
                <Label>Login no sistema</Label>
                <Select value={form.user_id ?? "none"} onValueChange={(v) => setForm({ ...form, user_id: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem login</SelectItem>
                    {linkable.map((m) => (
                      <SelectItem key={m.user_id} value={m.user_id}>{m.profile?.full_name || m.profile?.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Convide em Equipe com o papel Profissional; ela passa a ver a própria agenda.</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cor no calendário</Label>
              <div className="flex flex-wrap gap-2">
                {PROFESSIONAL_COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                    className={cn("h-8 w-8 rounded-full ring-offset-2 transition", form.color === c && "ring-2 ring-foreground")}
                    style={{ background: c }} aria-label={`Cor ${c}`} />
                ))}
              </div>
            </div>
            <label className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
              <span>Ativo<span className="block text-xs text-muted-foreground">Inativo sai da agenda, mas o histórico fica.</span></span>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </label>
          </TabsContent>

          <TabsContent value="servicos" className="space-y-4 pt-3">
            <p className="text-xs text-muted-foreground">Marque o que este profissional faz. Preço, duração e comissão próprios são opcionais; em branco vale o padrão do serviço.</p>
            {[...categories.map((c) => ({ id: c.id as string | null, name: c.name })), { id: null, name: "Sem categoria" }].map((cat) => {
              const list = activeServices.filter((s) => s.category_id === cat.id);
              if (!list.length) return null;
              return (
                <div key={cat.id ?? "none"}>
                  <div className="label-caps mb-2">{cat.name}</div>
                  <div className="space-y-2">
                    {list.map((s) => {
                      const o = selected[s.id];
                      return (
                        <div key={s.id} className="rounded-xl border border-border p-3">
                          <label className="flex items-center gap-3 text-sm">
                            <Checkbox checked={Boolean(o)} onCheckedChange={(v) => toggleService(s.id, Boolean(v))} />
                            <span className="flex-1">{s.name}</span>
                            <span className="text-xs text-muted-foreground">{s.duration_minutes} min · R$ {Number(s.price).toFixed(2)}</span>
                          </label>
                          {o && (
                            <div className="mt-2 grid grid-cols-3 gap-2 pl-7">
                              {([["price", "Preço"], ["duration_minutes", "Duração"], ["commission_pct", "Comissão %"]] as const).map(([k, label]) => (
                                <Input key={k} type="number" placeholder={label} className="h-8 text-xs" value={o[k] ?? ""}
                                  onChange={(e) => setSelected((sel) => ({ ...sel, [s.id]: { ...sel[s.id], [k]: e.target.value === "" ? null : Number(e.target.value) } }))} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {activeServices.length === 0 && <p className="text-sm text-muted-foreground">Cadastre serviços primeiro em Serviços.</p>}
          </TabsContent>

          <TabsContent value="jornada" className="space-y-2 pt-3">
            <p className="text-xs text-muted-foreground">O vão entre duas faixas é o intervalo (almoço). Dia sem faixa = folga. A agenda só aceita horários dentro da jornada, a não ser como encaixe.</p>
            {WEEKDAYS.map((d) => (
              <div key={d.iso} className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-2.5">
                <div className="w-20 text-sm font-medium">{d.long}</div>
                {week[d.iso].length === 0 && <span className="text-xs text-muted-foreground">Folga</span>}
                {week[d.iso].map((r, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <Input type="time" value={r.start_time} onChange={(e) => setRange(d.iso, i, { start_time: e.target.value })} className="h-8 w-[104px]" />
                    <span className="text-xs">às</span>
                    <Input type="time" value={r.end_time} onChange={(e) => setRange(d.iso, i, { end_time: e.target.value })} className="h-8 w-[104px]" />
                    <button type="button" onClick={() => setWeek((w) => ({ ...w, [d.iso]: w[d.iso].filter((_, j) => j !== i) }))} className="rounded p-1 hover:bg-muted" aria-label="Remover faixa">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="ghost" className="ml-auto h-8"
                  onClick={() => setWeek((w) => ({ ...w, [d.iso]: [...w[d.iso], { start_time: w[d.iso].at(-1)?.end_time ?? "09:00", end_time: "19:00" }] }))}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> faixa
                </Button>
              </div>
            ))}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>{save.isPending ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
