// Disparo da fila de WhatsApp. Chamada a cada minuto pelo pg_cron (pg_net),
// com o cabeçalho x-cron-secret (ou a service role no Authorization).
// 1. roda as automações por tempo (lembretes, aniversário, reativação...)
// 2. pede um lote à fila: o banco já aplica janela, limite diário, opt-out e espaçamento
// 3. envia pela Z-API respeitando o atraso de cada mensagem e devolve o resultado
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { zapiSendText } from "../_shared/zapi.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// Só para testes locais com uma Z-API de mentira
const ZAPI_BASE_URL = Deno.env.get("ZAPI_BASE_URL") ?? undefined;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const MAX_DELAY_SECONDS = 90;

type Claimed = {
  id: string;
  salon_id: string;
  phone: string;
  body: string;
  instance_id: string;
  token: string;
  client_token: string | null;
  delay_seconds: number;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const auth = req.headers.get("Authorization") ?? "";
  const cron = req.headers.get("x-cron-secret") ?? "";
  if (!(CRON_SECRET && cron === CRON_SECRET) && auth !== `Bearer ${SERVICE_ROLE}`) {
    return json({ error: "Não autorizado" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const started = Date.now();

  const auto = await admin.rpc("run_automations");
  if (auto.error) console.error("run_automations", auto.error);

  const { data, error } = await admin.rpc("claim_whatsapp_messages", { p_max_per_salon: 10 });
  if (error) {
    console.error("claim_whatsapp_messages", error);
    return json({ error: error.message }, 500);
  }
  const batch = (data ?? []) as Claimed[];

  // Um salão por vez em cada fila; salões diferentes em paralelo
  const bySalon = new Map<string, Claimed[]>();
  for (const m of batch) bySalon.set(m.salon_id, [...(bySalon.get(m.salon_id) ?? []), m]);

  let sent = 0;
  let failed = 0;
  await Promise.all(
    [...bySalon.values()].map(async (msgs) => {
      for (const m of msgs.sort((a, b) => a.delay_seconds - b.delay_seconds)) {
        const wait = Math.min(m.delay_seconds, MAX_DELAY_SECONDS) * 1000 - (Date.now() - started);
        if (wait > 0) await sleep(wait);
        const res = await zapiSendText({ instanceId: m.instance_id, token: m.token, clientToken: m.client_token, baseUrl: ZAPI_BASE_URL }, m.phone, m.body);
        const report = await admin.rpc("report_whatsapp_result", res.ok
          ? { p_id: m.id, p_ok: true, p_provider_message_id: res.messageId }
          : { p_id: m.id, p_ok: false, p_error: res.error, p_final: !res.retryable });
        if (report.error) console.error("report_whatsapp_result", report.error);
        if (res.ok) sent++;
        else failed++;
      }
    }),
  );

  return json({ ok: true, automations: auto.data ?? 0, claimed: batch.length, sent, failed });
});
