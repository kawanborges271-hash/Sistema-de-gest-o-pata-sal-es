// Convite de equipe por e-mail.
// O convite é criado com o JWT de quem chama, então a RLS garante que só o admin do salão convida.
// O envio do e-mail usa a service role (inviteUserByEmail), que nunca sai do servidor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");

const ROLES = ["admin", "recepcao", "profissional"] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método não suportado" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Não autenticado" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const { data: me, error: meErr } = await userClient.auth.getUser();
  if (meErr || !me.user) return json({ error: "Não autenticado" }, 401);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "invite");
  const origin = APP_URL || String(body.app_url ?? "").replace(/\/$/, "");
  if (!origin) return json({ error: "APP_URL não configurada" }, 500);

  let invitation: { id: string; token: string; email: string; full_name: string | null; salon_id: string } | null = null;

  if (action === "invite") {
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "");
    const salonId = String(body.salon_id ?? "");
    const fullName = String(body.full_name ?? "").trim() || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "E-mail inválido" }, 400);
    if (!ROLES.includes(role as (typeof ROLES)[number])) return json({ error: "Papel inválido" }, 400);

    // Revoga convite pendente anterior para o mesmo e-mail (RLS: só admin consegue)
    await userClient
      .from("invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("salon_id", salonId)
      .eq("email", email)
      .is("accepted_at", null)
      .is("revoked_at", null);

    const { data, error } = await userClient
      .from("invitations")
      .insert({ salon_id: salonId, email, role, full_name: fullName, invited_by: me.user.id })
      .select("id, token, email, full_name, salon_id")
      .single();
    if (error) {
      const status = error.code === "42501" ? 403 : 400;
      return json({ error: status === 403 ? "Só o administrador do salão pode convidar" : error.message }, status);
    }
    invitation = data;
  } else if (action === "resend") {
    const { data, error } = await userClient
      .from("invitations")
      .update({ expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() })
      .eq("id", String(body.invitation_id ?? ""))
      .is("accepted_at", null)
      .is("revoked_at", null)
      .select("id, token, email, full_name, salon_id")
      .maybeSingle();
    if (error || !data) return json({ error: "Convite não encontrado" }, 404);
    invitation = data;
  } else {
    return json({ error: "Ação inválida" }, 400);
  }

  const link = `${origin}/convite/${invitation.token}`;
  const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(invitation.email, {
    redirectTo: link,
    data: { full_name: invitation.full_name ?? invitation.email.split("@")[0] },
  });

  // Usuário que já tem conta não recebe e-mail de convite do Auth: devolvemos o link para o admin enviar.
  return json({ ok: true, invitation_id: invitation.id, link, emailed: !mailErr });
});
