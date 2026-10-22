// Cliente mínimo da Z-API e leitura do webhook de mensagens recebidas.
// Sem dependências do Deno: também é testado pelo Vitest (src/test/zapi.test.ts).

export const ZAPI_BASE = "https://api.z-api.io";

export type ZapiCredentials = { instanceId: string; token: string; clientToken?: string | null; baseUrl?: string };

export type InboundMessage = {
  kind: "message";
  instanceId: string;
  messageId: string | null;
  phone: string;
  senderName: string | null;
  body: string;
  fromMe: boolean;
  at: string;
};

export type IgnoredPayload = { kind: "ignore"; reason: string };

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const obj = (v: unknown): Json | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null);

/** Texto legível de qualquer tipo de mensagem (texto, botão, lista, mídia com legenda). */
function messageBody(p: Json): string | null {
  const text = obj(p.text);
  if (text && str(text.message)) return str(text.message);
  const button = obj(p.buttonsResponseMessage);
  if (button && str(button.message)) return str(button.message);
  const list = obj(p.listResponseMessage);
  if (list) return str(list.title) ?? str(list.message);
  const reaction = obj(p.reaction);
  if (reaction && str(reaction.value)) return str(reaction.value);
  for (const [key, label] of [["image", "foto"], ["video", "vídeo"], ["audio", "áudio"], ["document", "documento"], ["sticker", "figurinha"], ["location", "localização"], ["contact", "contato"]] as const) {
    const media = obj(p[key]);
    if (media) {
      const caption = str(media.caption) ?? str(media.fileName);
      return caption ? `[${label}] ${caption}` : `[${label}]`;
    }
  }
  return null;
}

/**
 * Lê o corpo do webhook "Ao receber" da Z-API (type = ReceivedCallback).
 * Grupos, canais, listas de transmissão e status são ignorados.
 */
export function parseZapiWebhook(payload: unknown): InboundMessage | IgnoredPayload {
  const p = obj(payload);
  if (!p) return { kind: "ignore", reason: "corpo inválido" };
  if (p.type !== "ReceivedCallback") return { kind: "ignore", reason: `tipo ${String(p.type ?? "desconhecido")}` };
  if (p.isGroup === true || p.isNewsletter === true || p.broadcast === true) return { kind: "ignore", reason: "grupo ou canal" };
  if (p.waitingMessage === true) return { kind: "ignore", reason: "mensagem aguardando" };

  const instanceId = str(p.instanceId);
  const rawPhone = str(p.phone);
  if (!instanceId) return { kind: "ignore", reason: "sem instanceId" };
  if (!rawPhone || /[@-]/.test(rawPhone)) return { kind: "ignore", reason: "telefone inválido" };
  const phone = rawPhone.replace(/\D/g, "");
  if (phone.length < 10 || phone.length > 15) return { kind: "ignore", reason: "telefone inválido" };

  const body = messageBody(p);
  if (!body) return { kind: "ignore", reason: "mensagem sem conteúdo" };

  const moment = typeof p.momment === "number" ? p.momment : typeof p.moment === "number" ? p.moment : null;
  return {
    kind: "message",
    instanceId,
    messageId: str(p.messageId),
    phone,
    senderName: str(p.senderName) ?? str(p.chatName),
    body: body.slice(0, 4000),
    fromMe: p.fromMe === true,
    at: new Date(moment && moment > 1e12 ? moment : moment ? moment * 1000 : Date.now()).toISOString(),
  };
}

export function zapiUrl(c: ZapiCredentials, path: string): string {
  return `${(c.baseUrl || ZAPI_BASE).replace(/\/$/, "")}/instances/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.token)}/${path}`;
}

function headers(c: ZapiCredentials): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (c.clientToken) h["Client-Token"] = c.clientToken;
  return h;
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    return String(j.error ?? j.message ?? j.value ?? text).slice(0, 300) || `HTTP ${res.status}`;
  } catch {
    return (text || `HTTP ${res.status}`).slice(0, 300);
  }
}

export type SendResult = { ok: true; messageId: string | null } | { ok: false; error: string; retryable: boolean };

/** Envia texto. Erro 4xx (exceto 429) não adianta repetir. */
export async function zapiSendText(c: ZapiCredentials, phone: string, message: string, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  try {
    const res = await fetchImpl(zapiUrl(c, "send-text"), {
      method: "POST",
      headers: headers(c),
      body: JSON.stringify({ phone, message }),
    });
    if (!res.ok) {
      return { ok: false, error: await readError(res), retryable: res.status >= 500 || res.status === 429 };
    }
    const j = (await res.json().catch(() => ({}))) as Json;
    return { ok: true, messageId: str(j.messageId) ?? str(j.zaapId) ?? str(j.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), retryable: true };
  }
}

export type ZapiStatus = { connected: boolean; smartphoneConnected: boolean | null; error: string | null };

export async function zapiStatus(c: ZapiCredentials, fetchImpl: typeof fetch = fetch): Promise<ZapiStatus> {
  try {
    const res = await fetchImpl(zapiUrl(c, "status"), { headers: headers(c) });
    if (!res.ok) return { connected: false, smartphoneConnected: null, error: await readError(res) };
    const j = (await res.json().catch(() => ({}))) as Json;
    return {
      connected: j.connected === true,
      smartphoneConnected: typeof j.smartphoneConnected === "boolean" ? j.smartphoneConnected : null,
      error: str(j.error),
    };
  } catch (e) {
    return { connected: false, smartphoneConnected: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** QR code para parear o celular (imagem em base64), quando a instância ainda não está conectada. */
export async function zapiQrCode(c: ZapiCredentials, fetchImpl: typeof fetch = fetch): Promise<{ image: string | null; error: string | null }> {
  try {
    const res = await fetchImpl(zapiUrl(c, "qr-code/image"), { headers: headers(c) });
    if (!res.ok) return { image: null, error: await readError(res) };
    const j = (await res.json().catch(() => ({}))) as Json;
    const value = str(j.value);
    if (!value) return { image: null, error: str(j.error) ?? "A instância já está conectada" };
    return { image: value.startsWith("data:") ? value : `data:image/png;base64,${value}`, error: null };
  } catch (e) {
    return { image: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Aponta o webhook "Ao receber" da instância para a nossa função. */
export async function zapiSetReceivedWebhook(c: ZapiCredentials, url: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; error: string | null }> {
  try {
    const res = await fetchImpl(zapiUrl(c, "update-webhook-received"), {
      method: "PUT",
      headers: headers(c),
      body: JSON.stringify({ value: url }),
    });
    if (!res.ok) return { ok: false, error: await readError(res) };
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function webhookUrl(supabaseUrl: string, salonId: string, secret: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/whatsapp-webhook?salon=${encodeURIComponent(salonId)}&secret=${encodeURIComponent(secret)}`;
}

/** Comparação de segredo em tempo constante. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
