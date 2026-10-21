import { describe, expect, it } from "vitest";
import { paymentBalance, paymentFee, stockLabel, stockLevel } from "@/lib/finance";
import { errorMessage, isCashClosed } from "@/lib/errors";
import type { PaymentMethod } from "@/lib/types";

const method = (id: string, kind: PaymentMethod["kind"], fee = 0, inst = 0): PaymentMethod => ({
  id, salon_id: "s", name: id, kind, fee_pct: fee, installment_fee_pct: inst, max_installments: 6, sort_order: 0, active: true,
});

describe("pagamentos", () => {
  it("taxa igual à do banco: 3,49% + 1,5% por parcela extra", () => {
    expect(paymentFee(method("c", "credito", 3.49, 1.5), 100, 2)).toBe(4.99);
    expect(paymentFee(method("c", "credito", 3.49, 1.5), 40, 1)).toBe(1.4);
  });
  it("calcula o que falta e o troco do dinheiro", () => {
    const methods = [method("din", "dinheiro"), method("pix", "pix")];
    const r = paymentBalance(129.9, [
      { payment_method_id: "pix", amount: 100, installments: 1 },
      { payment_method_id: "din", amount: 29.9, installments: 1, received: 50 },
    ], methods);
    expect(r.remaining).toBe(0);
    expect(r.change).toBe(20.1);
  });
  it("soma em centavos (0,1 + 0,2 fecha 0,3)", () => {
    expect(paymentBalance(0.3, [
      { payment_method_id: "pix", amount: 0.1, installments: 1 },
      { payment_method_id: "pix", amount: 0.2, installments: 1 },
    ], [method("pix", "pix")]).remaining).toBe(0);
  });
});

describe("estoque", () => {
  it("mostra a unidade base e as embalagens", () => {
    expect(stockLabel({ unit: "ml", package_size: 900 }, 1350)).toBe("1.350 ml (≈ 1,5 emb.)");
    expect(stockLabel({ unit: "un", package_size: 1 }, 3)).toBe("3 un");
  });
  it("classifica o nível do estoque", () => {
    expect(stockLevel({ current_stock: 0, min_stock: 2 })).toBe("zerado");
    expect(stockLevel({ current_stock: 2, min_stock: 2 })).toBe("baixo");
    expect(stockLevel({ current_stock: 5, min_stock: 2 })).toBe("ok");
  });
});

describe("mensagens do caixa", () => {
  it("tira o prefixo técnico", () => {
    const err = { message: "CAIXA_FECHADO: abra o caixa para fechar comandas" };
    expect(isCashClosed(err)).toBe(true);
    expect(errorMessage(err)).toBe("Abra o caixa para fechar comandas");
  });
});
