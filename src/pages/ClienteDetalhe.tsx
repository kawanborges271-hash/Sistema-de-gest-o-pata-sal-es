import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Archive, ArrowLeft, CalendarPlus, Camera, FlaskConical, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KpiCard } from "@/components/common/KpiCard";
import { EmptyState } from "@/components/common/EmptyState";
import { LifecycleBadge, StatusBadge } from "@/components/common/StatusBadge";
import { ClientDialog } from "@/components/clientes/ClientDialog";
import { AppointmentDialog } from "@/components/agenda/AppointmentDialog";
import { AppointmentSheet } from "@/components/agenda/AppointmentSheet";
import { ClientOrdersTab } from "@/components/clientes/ClientOrdersTab";
import { ClientLoyaltyTab } from "@/components/fidelidade/ClientLoyaltyTab";
import { Conversation } from "@/components/crm/Conversation";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useProfessionals, useServices } from "@/hooks/useCatalog";
import {
  useAddClientNote, useArchiveClientNote, useClient, useClientHistory, useClientNotes, useClientPhotos, useSaveClient, useUploadClientPhoto,
} from "@/hooks/useClients";
import { CLIENT_ORIGIN_LABEL, TECH_NOTE_LABEL } from "@/lib/agenda";
import { errorMessage } from "@/lib/errors";
import { EMPTY, formatPhone, money, num } from "@/lib/format";
import { fmtDate, fmtDateTime, fmtTime, todayKey } from "@/lib/tz";
import type { ClientPhoto, TechNoteKind } from "@/lib/types";

const COLOR_FIELDS = [["marca", "Marca"], ["tom", "Tom / número"], ["ox", "OX / volume"], ["tempo", "Tempo de pausa"]] as const;

export default function ClienteDetalhe() {
  const { id } = useParams();
  const { salon } = useAuth();
  const tz = salon!.timezone;
  const { can } = usePermissions();
  const editable = can("clientes.editar");
  const { data: c, isLoading } = useClient(id);
  const { data: history = [] } = useClientHistory(id);
  const { data: notes = [] } = useClientNotes(id);
  const { data: photos = [] } = useClientPhotos(id);
  const { data: services = [] } = useServices();
  const { data: pros = [] } = useProfessionals();
  const saveClient = useSaveClient();
  const addNote = useAddClientNote();
  const archiveNote = useArchiveClientNote();
  const upload = useUploadClientPhoto();

  const [editOpen, setEditOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [note, setNote] = useState({ kind: "geral" as TechNoteKind, title: "", body: "", data: {} as Record<string, string> });
  const [photoKind, setPhotoKind] = useState<ClientPhoto["kind"]>("antes");
  const fileRef = useRef<HTMLInputElement>(null);

  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando…</div>;
  if (!c) {
    return <EmptyState icon={Archive} title="Cliente não encontrada" description="Ela pode ter sido arquivada ou você não tem acesso." action={<Button asChild variant="outline"><Link to="/clientes">Voltar</Link></Button>} />;
  }

  const svc = (sid: string) => services.find((s) => s.id === sid)?.name ?? "Serviço";
  const pro = (pid: string) => pros.find((p) => p.id === pid)?.name ?? "";
  const ticket = c.visits_count > 0 && c.total_spent !== null ? Number(c.total_spent) / c.visits_count : null;
  const allergies = notes.filter((n) => n.kind === "alergia");

  const submitNote = async () => {
    const hasData = Object.values(note.data).some(Boolean);
    if (!note.body.trim() && !hasData) return toast.error("Escreva a anotação");
    const body = note.body.trim() || COLOR_FIELDS.map(([k, l]) => (note.data[k] ? `${l}: ${note.data[k]}` : "")).filter(Boolean).join(" · ");
    try {
      await addNote.mutateAsync({ client_id: c.id, kind: note.kind, title: note.title.trim() || null, body, data: note.data });
      setNote({ kind: note.kind, title: "", body: "", data: {} });
      toast.success("Ficha atualizada");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await upload.mutateAsync({ clientId: c.id, file, kind: photoKind });
      toast.success("Foto salva");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleArchive = async () => {
    try {
      await saveClient.mutateAsync({ id: c.id, archived_at: c.archived_at ? null : new Date().toISOString() });
      toast.success(c.archived_at ? "Cliente reativada" : "Cliente arquivada. O histórico continua salvo.");
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <div>
      <Link to="/clientes" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Clientes</Link>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <LifecycleBadge status={c.lifecycle_status} />
            <span className="text-xs text-muted-foreground">{CLIENT_ORIGIN_LABEL[c.origin]} · cliente desde {fmtDate(c.created_at, tz)}</span>
            {c.archived_at && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">arquivada</span>}
            {c.opt_out && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">não recebe WhatsApp automático</span>}
          </div>
          <h1 className="mt-3 font-display text-3xl font-light md:text-[40px]">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{formatPhone(c.phone)}</span>
            {c.email && <span>{c.email}</span>}
            {c.birth_date && <span>Aniversário {c.birth_date.slice(8, 10)}/{c.birth_date.slice(5, 7)}</span>}
            {c.phone && <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-success hover:underline"><MessageCircle className="h-4 w-4" /> WhatsApp</a>}
          </div>
          {c.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{c.tags.map((t) => <span key={t} className="rounded-full bg-accent px-2 py-0.5 text-[11px] text-accent-foreground">{t}</span>)}</div>}
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="mr-1 h-4 w-4" /> Editar</Button>
            <Button variant="outline" onClick={toggleArchive}><Archive className="mr-1 h-4 w-4" /> {c.archived_at ? "Desarquivar" : "Arquivar"}</Button>
            {!c.archived_at && <Button onClick={() => setBookOpen(true)}><CalendarPlus className="mr-1 h-4 w-4" /> Agendar</Button>}
          </div>
        )}
      </div>

      {allergies.length > 0 && (
        <div className="mb-5 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <b className="text-destructive">Alergias declaradas:</b> {allergies.map((a) => a.body).join("; ")}
        </div>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard label="Total gasto" value={money(c.total_spent === null ? null : Number(c.total_spent))} formula="Soma dos atendimentos concluídos" highlight />
        <KpiCard label="Visitas" value={num(c.visits_count || null)} formula="Atendimentos concluídos" />
        <KpiCard label="Ticket médio" value={money(ticket)} formula="Total gasto ÷ visitas" />
        <KpiCard label="Frequência" value={c.avg_frequency_days ? `${c.avg_frequency_days} dias` : EMPTY} formula="Média de dias entre visitas" />
        <KpiCard label="Próximo retorno" value={c.next_return_at ? fmtDate(c.next_return_at, tz) : EMPTY} formula="Último serviço + intervalo de retorno" />
      </div>

      {c.notes && <p className="mb-6 rounded-2xl border border-border bg-card p-4 text-sm shadow-soft">{c.notes}</p>}

      <Tabs defaultValue="historico">
        <TabsList className="flex w-full justify-start overflow-x-auto">
          <TabsTrigger value="historico">Histórico ({history.length})</TabsTrigger>
          <TabsTrigger value="ficha">Ficha técnica ({notes.length})</TabsTrigger>
          <TabsTrigger value="fotos">Fotos ({photos.length})</TabsTrigger>
          {can("comandas") && <TabsTrigger value="comandas">Comandas e pacotes</TabsTrigger>}
          {can("fidelidade") && <TabsTrigger value="fidelidade">Fidelidade</TabsTrigger>}
          {can("crm") && c.phone && <TabsTrigger value="whatsapp">WhatsApp</TabsTrigger>}
        </TabsList>

        <TabsContent value="historico" className="pt-4">
          {history.length === 0 ? (
            <EmptyState icon={CalendarPlus} title="Nenhum atendimento ainda" description="Quando ela for atendida, o histórico aparece aqui com serviços, profissional e valor."
              action={editable && <Button onClick={() => setBookOpen(true)}>Agendar agora</Button>} />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
              {history.map((a) => (
                <button key={a.id} onClick={() => setSheetId(a.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/50">
                  <span className="w-36">{fmtDate(a.starts_at, tz)} {fmtTime(a.starts_at, tz)}</span>
                  <span className="min-w-[180px] flex-1">{(a.items ?? []).map((i) => svc(i.service_id)).join(" + ")}</span>
                  <span className="w-40 truncate text-muted-foreground">{[...new Set((a.items ?? []).map((i) => pro(i.professional_id)))].join(", ")}</span>
                  <span className="w-24 text-right">{money((a.items ?? []).reduce((s, i) => s + Number(i.price), 0))}</span>
                  <StatusBadge status={a.status} />
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ficha" className="space-y-4 pt-4">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-soft">
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select value={note.kind} onValueChange={(v) => setNote({ ...note, kind: v as TechNoteKind, data: {} })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(TECH_NOTE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Título (opcional)</Label><Input value={note.title} onChange={(e) => setNote({ ...note, title: e.target.value })} placeholder="Ex.: Retoque de raiz" /></div>
            </div>
            {note.kind === "coloracao" && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {COLOR_FIELDS.map(([k, l]) => (
                  <Input key={k} placeholder={l} value={note.data[k] ?? ""} onChange={(e) => setNote({ ...note, data: { ...note.data, [k]: e.target.value } })} />
                ))}
              </div>
            )}
            <Textarea className="mt-3" rows={3} value={note.body} onChange={(e) => setNote({ ...note, body: e.target.value })}
              placeholder={note.kind === "alergia" ? "O que a cliente declarou (ex.: alergia a PPD)" : "Detalhes, reação, resultado…"} />
            <Button className="mt-3" onClick={submitNote} disabled={addNote.isPending}><FlaskConical className="mr-1 h-4 w-4" /> Salvar na ficha</Button>
          </div>
          {notes.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma anotação. Registre fórmulas de coloração, tipo de cabelo e alergias declaradas.</p>}
          {notes.map((n) => (
            <div key={n.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="label-caps">{TECH_NOTE_LABEL[n.kind]} · {fmtDateTime(n.created_at, tz)}{n.professional_id && ` · ${pro(n.professional_id)}`}</div>
                  {n.title && <div className="mt-1 font-medium">{n.title}</div>}
                </div>
                {editable && <button className="rounded p-1 hover:bg-muted" aria-label="Arquivar anotação" onClick={() => archiveNote.mutate(n.id)}><Trash2 className="h-4 w-4" /></button>}
              </div>
              {Object.keys(n.data ?? {}).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {Object.entries(n.data).filter(([, v]) => v).map(([k, v]) => <span key={k} className="rounded-md bg-muted px-2 py-1">{COLOR_FIELDS.find(([f]) => f === k)?.[1] ?? k}: <b>{v}</b></span>)}
                </div>
              )}
              <p className="mt-2 whitespace-pre-wrap text-sm">{n.body}</p>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="fotos" className="pt-4">
          {!c.photo_consent_at ? (
            <EmptyState icon={Camera} title="Sem autorização para fotos"
              description="Pela LGPD, registre o consentimento da cliente antes de guardar fotos de antes e depois."
              action={editable && <Button onClick={() => saveClient.mutate({ id: c.id, photo_consent_at: new Date().toISOString() }, { onSuccess: () => toast.success("Consentimento registrado") })}>Registrar consentimento</Button>} />
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Select value={photoKind} onValueChange={(v) => setPhotoKind(v as ClientPhoto["kind"])}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="antes">Antes</SelectItem><SelectItem value="depois">Depois</SelectItem><SelectItem value="referencia">Referência</SelectItem></SelectContent>
                </Select>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <Button onClick={() => fileRef.current?.click()} disabled={upload.isPending}><Camera className="mr-1 h-4 w-4" /> {upload.isPending ? "Enviando…" : "Adicionar foto"}</Button>
                <span className="text-xs text-muted-foreground">Consentimento em {fmtDate(c.photo_consent_at, tz)}. Fotos ficam em armazenamento privado.</span>
              </div>
              {photos.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma foto ainda.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {photos.map((p) => (
                    <figure key={p.id} className="overflow-hidden rounded-2xl border border-border bg-card shadow-soft">
                      {p.url ? <img src={p.url} alt={`${p.kind} ${fmtDate(p.created_at, tz)}`} className="aspect-square w-full object-cover" /> : <div className="aspect-square bg-muted" />}
                      <figcaption className="px-3 py-2 text-xs capitalize text-muted-foreground">{p.kind} · {fmtDate(p.created_at, tz)}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </>
          )}
        </TabsContent>

        {can("comandas") && (
          <TabsContent value="comandas" className="pt-4">
            <ClientOrdersTab clientId={c.id} tz={tz} />
          </TabsContent>
        )}

        {can("fidelidade") && (
          <TabsContent value="fidelidade" className="pt-4">
            <ClientLoyaltyTab client={c} />
          </TabsContent>
        )}
        {can("crm") && c.phone && (
          <TabsContent value="whatsapp" className="pt-4">
            <Conversation phone={c.phone} clientId={c.id} optedOut={c.opt_out} className="max-w-2xl" />
          </TabsContent>
        )}
      </Tabs>

      <ClientDialog open={editOpen} onOpenChange={setEditOpen} client={c} />
      <AppointmentDialog open={bookOpen} onOpenChange={setBookOpen}
        defaults={{ day: todayKey(tz), time: "09:00", client: { id: c.id, name: c.name, phone: c.phone } }}
        onCreated={(aid) => setSheetId(aid)} />
      <AppointmentSheet id={sheetId} onOpenChange={(o) => !o && setSheetId(null)} onSelect={setSheetId} onBook={() => setSheetId(null)} />
    </div>
  );
}
