import { describe, expect, it, vi } from "vitest";
import {
  parseZapiWebhook, safeEqual, webhookUrl, zapiQrCode, zapiSendText, zapiStatus, zapiUrl,
} from "../../supabase/functions/_shared/zapi";

const base = {
  type: "ReceivedCallback",
  instanceId: "3C01A2B3",
  messageId: "3EB0ABC",
  phone: "5511999998888",
  fromMe: false,
  momment: 1761134400000,
  senderName: "Paula",
  chatName: "Paula Souza",
  isGroup: false,
};

describe("parseZapiWebhook", () => {
  it("lê mensagem de texto", () => {
    const m = parseZapiWebhook({ ...base, text: { message: "Oi, tudo bem?" } });
    expect(m).toEqual({
      kind: "message", instanceId: "3C01A2B3", messageId: "3EB0ABC", phone: "5511999998888",
      senderName: "Paula", body: "Oi, tudo bem?", fromMe: false, at: new Date(1761134400000).toISOString(),
    });
  });

  it("lê resposta de botão, lista e mídia com legenda", () => {
    expect(parseZapiWebhook({ ...base, buttonsResponseMessage: { buttonId: "1", message: "SIM" } })).toMatchObject({ body: "SIM" });
    expect(parseZapiWebhook({ ...base, listResponseMessage: { title: "Sábado 10h" } })).toMatchObject({ body: "Sábado 10h" });
    expect(parseZapiWebhook({ ...base, image: { caption: "esse corte", imageUrl: "x" } })).toMatchObject({ body: "[foto] esse corte" });
    expect(parseZapiWebhook({ ...base, audio: { audioUrl: "x" } })).toMatchObject({ body: "[áudio]" });
  });

  it("ignora grupos, outros eventos e mensagens vazias", () => {
    expect(parseZapiWebhook({ ...base, isGroup: true, text: { message: "oi" } }).kind).toBe("ignore");
    expect(parseZapiWebhook({ ...base, type: "MessageStatusCallback" }).kind).toBe("ignore");
    expect(parseZapiWebhook({ ...base, phone: "120363-group", text: { message: "oi" } }).kind).toBe("ignore");
    expect(parseZapiWebhook({ ...base }).kind).toBe("ignore");
    expect(parseZapiWebhook(null).kind).toBe("ignore");
    expect(parseZapiWebhook({ ...base, instanceId: undefined, text: { message: "oi" } }).kind).toBe("ignore");
  });

  it("usa o nome do chat quando não vem o do remetente e marca as enviadas pelo celular", () => {
    const m = parseZapiWebhook({ ...base, senderName: undefined, fromMe: true, text: { message: "Bom dia!" } });
    expect(m).toMatchObject({ senderName: "Paula Souza", fromMe: true });
  });
});

describe("cliente Z-API", () => {
  const c = { instanceId: "INST", token: "TOK", clientToken: "CT" };

  it("monta a URL e o webhook", () => {
    expect(zapiUrl(c, "send-text")).toBe("https://api.z-api.io/instances/INST/token/TOK/send-text");
    expect(zapiUrl({ ...c, baseUrl: "http://localhost:9000/" }, "status")).toBe("http://localhost:9000/instances/INST/token/TOK/status");
    expect(webhookUrl("https://abc.supabase.co/", "s1", "seg")).toBe("https://abc.supabase.co/functions/v1/whatsapp-webhook?salon=s1&secret=seg");
  });

  it("envia texto com o Client-Token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ zaapId: "z1", messageId: "m1" }), { status: 200 }));
    const r = await zapiSendText(c, "5511999998888", "Olá", fetchMock as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, messageId: "m1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/send-text");
    expect(init.headers["Client-Token"]).toBe("CT");
    expect(JSON.parse(init.body)).toEqual({ phone: "5511999998888", message: "Olá" });
  });

  it("erro 4xx não é repetido; 5xx e rede são", async () => {
    const bad = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Instance not found" }), { status: 400 }));
    expect(await zapiSendText(c, "1", "x", bad as unknown as typeof fetch)).toEqual({ ok: false, error: "Instance not found", retryable: false });
    const down = vi.fn().mockResolvedValue(new Response("oops", { status: 503 }));
    expect(await zapiSendText(c, "1", "x", down as unknown as typeof fetch)).toMatchObject({ ok: false, retryable: true });
    const net = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(await zapiSendText(c, "1", "x", net as unknown as typeof fetch)).toEqual({ ok: false, error: "timeout", retryable: true });
  });

  it("lê status e QR code", async () => {
    const st = vi.fn().mockResolvedValue(new Response(JSON.stringify({ connected: true, smartphoneConnected: true }), { status: 200 }));
    expect(await zapiStatus(c, st as unknown as typeof fetch)).toEqual({ connected: true, smartphoneConnected: true, error: null });
    const qr = vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: "iVBORw0" }), { status: 200 }));
    expect(await zapiQrCode(c, qr as unknown as typeof fetch)).toEqual({ image: "data:image/png;base64,iVBORw0", error: null });
  });

  it("compara segredos", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
