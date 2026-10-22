import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  CashMovement, CashMovementKind, CashSession, CashSessionSummary, Order, OrderItem, OrderPayment, OrderStatus, PaymentMethod,
} from "@/lib/types";
import type { PaymentDraft } from "@/lib/finance";

function useSalonId() {
  return useAuth().salon?.id;
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

/** Tudo que muda quando uma comanda fecha ou cancela. */
const FINANCE_KEYS = ["orders", "order", "cash", "cash_history", "products", "stock_movements", "commissions",
  "client_packages", "client_orders", "appointments", "appointment", "client_overview"];

export function useInvalidateFinance() {
  const qc = useQueryClient();
  return () => Promise.all(FINANCE_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

// ---------------------------------------------------------------------
// Formas de pagamento
// ---------------------------------------------------------------------
export function usePaymentMethods() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["payment_methods", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<PaymentMethod[]>(
        supabase.from("payment_methods").select("*").eq("salon_id", salonId!).order("sort_order").order("name"),
      ),
  });
}

export function useSavePaymentMethod() {
  const salonId = useSalonId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: Partial<PaymentMethod> & { id?: string }) => {
      const payload = { ...m, salon_id: salonId };
      const { error } = m.id
        ? await supabase.from("payment_methods").update(payload).eq("id", m.id)
        : await supabase.from("payment_methods").insert(payload);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["payment_methods"] }),
  });
}

// ---------------------------------------------------------------------
// Caixa
// ---------------------------------------------------------------------
export type CashState = {
  session: CashSession | null;
  summary: CashSessionSummary | null;
  movements: CashMovement[];
};

/** Caixa aberto agora (no máximo um por salão), com resumo e movimentações. */
export function useOpenCash() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["cash", salonId],
    enabled: Boolean(salonId),
    queryFn: async (): Promise<CashState> => {
      const session = await unwrap<CashSession | null>(
        supabase.from("cash_sessions").select("*").eq("salon_id", salonId!).is("closed_at", null).maybeSingle(),
      );
      if (!session) return { session: null, summary: null, movements: [] };
      const [summary, movements] = await Promise.all([
        unwrap<CashSessionSummary>(
          supabase.from("cash_session_summary").select("*").eq("cash_session_id", session.id).single(),
        ),
        unwrap<CashMovement[]>(
          supabase.from("cash_movements").select("*").eq("cash_session_id", session.id).order("created_at", { ascending: false }),
        ),
      ]);
      return { session, summary, movements };
    },
  });
}

export function useCashHistory(limit = 30) {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["cash_history", salonId, limit],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<CashSessionSummary[]>(
        supabase.from("cash_session_summary").select("*").eq("salon_id", salonId!)
          .not("closed_at", "is", null).order("opened_at", { ascending: false }).limit(limit),
      ),
  });
}

export function useOpenCashSession() {
  const salonId = useSalonId();
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (opening: number) => {
      const { error } = await supabase.rpc("open_cash_session", { p_salon_id: salonId, p_opening_amount: opening });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useCloseCashSession() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (v: { id: string; counted: number; notes?: string }) => {
      const { data, error } = await supabase.rpc("close_cash_session", {
        p_session_id: v.id, p_counted_amount: v.counted, p_notes: v.notes || null,
      });
      if (error) throw error;
      return Number(data);
    },
    onSuccess: invalidate,
  });
}

export function useAddCashMovement() {
  const salonId = useSalonId();
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (m: { cash_session_id: string; kind: Exclude<CashMovementKind, "estorno">; amount: number; description: string }) => {
      const { error } = await supabase.from("cash_movements").insert({ ...m, salon_id: salonId });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

// ---------------------------------------------------------------------
// Comandas
// ---------------------------------------------------------------------
const ORDER_SELECT = "*, client:clients(id, name, phone)";

export function useOrders(filter: { status?: OrderStatus; fromIso?: string; toIso?: string }) {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["orders", salonId, filter],
    enabled: Boolean(salonId),
    queryFn: () => {
      let q = supabase.from("orders").select(ORDER_SELECT).eq("salon_id", salonId!);
      if (filter.status) q = q.eq("status", filter.status);
      if (filter.fromIso) q = q.gte(filter.status === "aberta" ? "opened_at" : "closed_at", filter.fromIso);
      if (filter.toIso) q = q.lt(filter.status === "aberta" ? "opened_at" : "closed_at", filter.toIso);
      return unwrap<Order[]>(q.order("number", { ascending: false }).limit(200));
    },
  });
}

export type OrderDetail = Order & { items: OrderItem[]; payments: OrderPayment[] };

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["order", id],
    enabled: Boolean(id),
    queryFn: () =>
      unwrap<OrderDetail>(
        supabase.from("orders")
          .select(`${ORDER_SELECT}, items:order_items(*), payments:order_payments(*)`)
          .eq("id", id!)
          .order("created_at", { referencedTable: "order_items" })
          .single(),
      ),
  });
}

export function useClientOrders(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client_orders", clientId],
    enabled: Boolean(clientId),
    queryFn: () =>
      unwrap<(Order & { items: Pick<OrderItem, "description" | "kind">[] })[]>(
        supabase.from("orders").select("*, items:order_items(description, kind)")
          .eq("client_id", clientId!).order("opened_at", { ascending: false }).limit(50),
      ),
  });
}

export function useCreateOrder() {
  const salonId = useSalonId();
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (clientId: string | null) => {
      const { data, error } = await supabase.from("orders").insert({ salon_id: salonId, client_id: clientId }).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: invalidate,
  });
}

export function useOpenOrderForAppointment() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async (appointmentId: string) => {
      const { data, error } = await supabase.rpc("open_order_for_appointment", { p_appointment_id: appointmentId });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidate,
  });
}

export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; client_id?: string | null; discount_amount?: number; discount_reason?: string | null; notes?: string | null }) => {
      const { error } = await supabase.from("orders").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] })]),
  });
}

export type NewOrderItem = Partial<Pick<OrderItem,
  "service_id" | "product_id" | "package_id" | "professional_id" | "client_package_balance_id" | "unit_price" | "discount_amount" | "quantity" | "description">> & {
  order_id: string;
  kind: OrderItem["kind"];
};

export function useAddOrderItem() {
  const salonId = useSalonId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: NewOrderItem) => {
      const { error } = await supabase.from("order_items").insert({ ...item, salon_id: salonId });
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] })]),
  });
}

export function useUpdateOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<OrderItem> & { id: string }) => {
      const { error } = await supabase.from("order_items").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] })]),
  });
}

export function useRemoveOrderItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("order_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["order"] }), qc.invalidateQueries({ queryKey: ["orders"] })]),
  });
}

export function useCloseOrder() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, payments }: { id: string; payments: PaymentDraft[] }) => {
      const { error } = await supabase.rpc("close_order", {
        p_order_id: id,
        p_payments: payments.map(({ payment_method_id, amount, installments }) => ({ payment_method_id, amount, installments })),
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useCancelOrder() {
  const invalidate = useInvalidateFinance();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase.rpc("cancel_order", { p_order_id: id, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

/** Comanda (não cancelada) ligada a um agendamento, se existir. */
export function useAppointmentOrder(appointmentId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["orders", "by_appointment", appointmentId],
    enabled: Boolean(appointmentId) && enabled,
    queryFn: () =>
      unwrap<Pick<Order, "id" | "number" | "status" | "total"> | null>(
        supabase.from("orders").select("id, number, status, total")
          .eq("appointment_id", appointmentId!).neq("status", "cancelada").maybeSingle(),
      ),
  });
}
