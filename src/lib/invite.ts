// Guarda o token do convite enquanto a pessoa cria a conta / faz login.
const KEY = "salon-os:invite-token";

export function rememberInvite(token: string) {
  try { sessionStorage.setItem(KEY, token); } catch { /* sem storage, segue */ }
}
export function pendingInvite(): string | null {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
}
export function clearInvite() {
  try { sessionStorage.removeItem(KEY); } catch { /* nada */ }
}
