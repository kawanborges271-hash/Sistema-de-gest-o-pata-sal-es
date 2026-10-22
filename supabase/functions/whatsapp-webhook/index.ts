// Webhook "Ao receber" da Z-API.
// URL: /functions/v1/whatsapp-webhook?salon=<id do salão>&secret=<segredo>
// Publicada com verify_jwt = false (a Z-API não manda JWT); quem autentica é o
// segredo da URL, conferido no banco junto com o ID da instância.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { parseZapiWebhook } from "../_shared/zapi.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  const url = new URL(req.url);
  const salonId = url.searchParams.get("salon") ?? "";
  const secret = url.searchParams.get("secret") ?? "";
  if (!UUID.test(salonId) || secret.length < 16) return json({ error: "Não autorizado" }, 401);

  const payload = await req.json().catch(() => null);
  const msg = parseZapiWebhook(payload);
  // Responde 200 no que não interessa, para a Z-API não ficar reenviando
  if (msg.kind === "ignore") return json({ ok: true, ignored: msg.reason });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("whatsapp_inbound", {
    p_salon_id: salonId,
    p_secret: secret,
    p_instance_id: msg.instanceId,
    p_message_id: msg.messageId,
    p_phone: msg.phone,
    p_sender_name: msg.senderName,
    p_body: msg.body,
    p_from_me: msg.fromMe,
    p_at: msg.at,
  });
  if (error) {
    if (error.message.includes("SEGREDO_INVALIDO")) return json({ error: "Não autorizado" }, 401);
    if (error.message.includes("INSTANCIA_INVALIDA")) return json({ error: "Instância não pertence a este salão" }, 403);
    console.error("whatsapp_inbound", error);
    return json({ error: "Falha ao registrar" }, 500);
  }
  return json({ ok: true, ...(data as Record<string, unknown>) });
});
