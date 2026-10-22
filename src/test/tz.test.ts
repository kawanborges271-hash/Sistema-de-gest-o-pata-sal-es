import { describe, expect, it } from "vitest";
import { addDaysKey, dayKey, isoWeekday, minutesOfDay, startOfWeekKey, zonedToUtc } from "@/lib/tz";
import { formatPhone, money, normalizePhone, EMPTY } from "@/lib/format";
import { scheduleConflict } from "@/lib/errors";

describe("fuso do salão", () => {
  it("converte hora de parede de São Paulo para UTC", () => {
    expect(zonedToUtc("2026-10-21", "09:00", "America/Sao_Paulo").toISOString()).toBe("2026-10-21T12:00:00.000Z");
  });
  it("lê dia e minutos no fuso do salão, não no do navegador", () => {
    const iso = "2026-10-22T01:30:00.000Z"; // 22:30 do dia 21 em SP
    expect(dayKey(iso, "America/Sao_Paulo")).toBe("2026-10-21");
    expect(minutesOfDay(iso, "America/Sao_Paulo")).toBe(22 * 60 + 30);
  });
  it("aritmética de calendário", () => {
    expect(addDaysKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(isoWeekday("2026-10-25")).toBe(7); // domingo
    expect(startOfWeekKey("2026-10-25")).toBe("2026-10-19");
  });
});

describe("formatação", () => {
  it("valor sem dado é travessão, nunca zero", () => {
    expect(money(null)).toBe(EMPTY);
    expect(money(0)).toContain("0,00");
  });
  it("telefone brasileiro", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("5511987654321");
    expect(formatPhone("5511987654321")).toBe("(11) 98765-4321");
  });
});

describe("conflitos de agenda", () => {
  it("reconhece os erros do banco", () => {
    expect(scheduleConflict({ code: "23P01", message: "conflicting key value" })).toBe("sobreposicao");
    expect(scheduleConflict({ code: "P0001", message: "FORA_DA_JORNADA: x" })).toBe("jornada");
    expect(scheduleConflict({ code: "P0001", message: "BLOQUEIO: x" })).toBe("bloqueio");
    expect(scheduleConflict({ code: "42501", message: "x" })).toBeNull();
  });
});
