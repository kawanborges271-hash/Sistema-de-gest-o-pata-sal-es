import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && key);

export const READ_ONLY_MESSAGE = "MODO_LEITURA: você está vendo este salão como suporte. Alterações estão bloqueadas.";

// Funções de leitura que as telas chamam por POST; no modo suporte só elas (e o Painel) passam.
const READ_RPCS = new Set([
  "dashboard_summary", "marketing_report", "intelligence_report", "intelligence_actions", "loyalty_summary",
  "waitlist_suggestions", "whatsapp_integration_status", "salon_plan_usage", "cash_session_expected",
]);

let readOnly = false;
/** Modo suporte do super admin: o banco já recusa escrita; aqui ela nem sai do navegador. */
export function setReadOnlyMode(on: boolean) {
  readOnly = on;
}

function blockedWrite(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (!readOnly) return false;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method === "GET" || method === "HEAD") return false;
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path.startsWith("/auth/")) return false;
  if (path.startsWith("/storage/v1/object/sign/")) return false;
  const rpc = path.match(/\/rest\/v1\/rpc\/([a-z_]+)/)?.[1];
  if (rpc) return !(READ_RPCS.has(rpc) || rpc.startsWith("platform_"));
  return true;
}

const guardedFetch: typeof fetch = (input, init) => {
  if (blockedWrite(input, init)) {
    const body = JSON.stringify({ message: READ_ONLY_MESSAGE, error: READ_ONLY_MESSAGE, code: "MODO_LEITURA" });
    return Promise.resolve(new Response(body, { status: 403, headers: { "Content-Type": "application/json" } }));
  }
  return fetch(input, init);
};

export const supabase = createClient(url ?? "http://localhost:54321", key ?? "public-anon-key", {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: guardedFetch },
});
