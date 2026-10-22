// Ações da tela de Configurações → WhatsApp (só admin do salão):
//   status  → pergunta à Z-API se o celular está conectado e guarda o resultado
//   qrcode  → QR code para parear o celular
//   webhook → aponta o webhook "Ao receber" da instância para whatsapp-webhook
//   test    → manda uma mensagem de teste
// As credenciais são lidas com a service role e nunca voltam para o navegador.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { webhookUrl, zapiQrCode, zapiSendText, zapiSetReceivedWebhook, zapiStatus } from "../_shared/zapi.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Só para testes locais com uma Z-API de mentira
const ZAPI_BASE_URL = Deno.env.get("ZAPI_BASE_URL") ?? undefined;
// URL pública do projeto (a que a Z-API consegue chamar). Em produção é a própria SUPABASE_URL.
const PUBLIC_URL = Deno.env.get("PUBLIC_SUPABASE_URL") ?? SUPABASE_URL;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);
  const body = await req.json().catch(() => ({}));
  const salonId = String(body.salon_id ?? "");
  const action = String(body.action ?? "status");

  // A RPC só responde para o admin do salão: é ela que autoriza
  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const { error: authErr } = await userClient.rpc("whatsapp_integration_status", { p_salon_id: salonId });
  if (authErr) return json({ error: "Só o administrador do salão configura o WhatsApp" }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: rows, error } = await admin.rpc("whatsapp_credentials", { p_salon_id: salonId });
  const cred = Array.isArray(rows) ? rows[0] : null;
  if (error || !cred?.instance_id || !cred?.token) return json({ error: "Salve o ID da instância e o token primeiro" }, 400);
  const c = { instanceId: cred.instance_id as string, token: cred.token as string, clientToken: cred.client_token as string | null, baseUrl: ZAPI_BASE_URL };

  if (action === "status") {
    const s = await zapiStatus(c);
    const status = s.connected ? "conectado" : s.error ? "erro" : "desconectado";
    await admin.rpc("set_whatsapp_status", { p_salon_id: salonId, p_status: status, p_error: s.error });
    return json({ ok: true, status, smartphone_connected: s.smartphoneConnected, error: s.error });
  }

  if (action === "qrcode") {
    const q = await zapiQrCode(c);
    return q.image ? json({ ok: true, image: q.image }) : json({ ok: false, error: q.error }, 409);
  }

  if (action === "webhook") {
    const url = webhookUrl(PUBLIC_URL, salonId, cred.webhook_secret as string);
    const r = await zapiSetReceivedWebhook(c, url);
    return r.ok ? json({ ok: true }) : json({ ok: false, error: r.error }, 502);
  }

  if (action === "test") {
    const phone = String(body.phone ?? cred.phone ?? "").replace(/\D/g, "");
    if (phone.length < 12) return json({ error: "Informe o número que vai receber o teste, com DDD" }, 400);
    const r = await zapiSendText(c, phone, "Teste do Salon OS: o WhatsApp do salão está conectado e enviando mensagens.");
    return r.ok ? json({ ok: true }) : json({ ok: false, error: r.error }, 502);
  }

  return json({ error: "Ação inválida" }, 400);
});
