export type SalonRole = "admin" | "recepcao" | "profissional";

export type Salon = {
  id: string;
  name: string;
  slug: string;
  whatsapp: string | null;
  email: string | null;
  address_street: string | null;
  address_number: string | null;
  address_district: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  timezone: string;
  business_hours: BusinessHours;
  commission_base: "bruto" | "liquido";
  commission_deduct_card_fee: boolean;
  commission_deduct_product_cost: boolean;
  onboarding_completed: boolean;
  suspended_at: string | null;
};

/** Chave = dia ISO ("1" = segunda ... "7" = domingo); valor = faixas ["09:00","19:00"]. */
export type BusinessHours = Record<string, [string, string][]>;

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  current_salon_id: string | null;
};

export type Membership = {
  id: string;
  salon_id: string;
  user_id: string;
  role: SalonRole;
  active: boolean;
  salon?: Pick<Salon, "id" | "name">;
};

export type ServiceCategory = { id: string; salon_id: string; name: string; sort_order: number; active: boolean };

export type Service = {
  id: string;
  salon_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  price_is_starting: boolean;
  return_interval_days: number | null;
  default_commission_pct: number;
  online_booking: boolean;
  active: boolean;
};

export type Professional = {
  id: string;
  salon_id: string;
  name: string;
  role_title: string | null;
  phone: string | null;
  email: string | null;
  color: string;
  default_commission_pct: number;
  user_id: string | null;
  sort_order: number;
  active: boolean;
};

export type ProfessionalService = {
  salon_id: string;
  professional_id: string;
  service_id: string;
  price: number | null;
  duration_minutes: number | null;
  commission_pct: number | null;
};

export type ProfessionalHour = {
  id: string;
  salon_id: string;
  professional_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
};

export type BlockKind = "folga" | "almoco" | "bloqueio" | "ferias" | "feriado";
export type ScheduleBlock = {
  id: string;
  salon_id: string;
  professional_id: string | null;
  kind: BlockKind;
  reason: string | null;
  starts_at: string;
  ends_at: string;
};

export type ClientOrigin = "indicacao" | "instagram" | "whatsapp" | "google" | "meta_ads" | "link_online" | "passante" | "outro";
export type LifecycleStatus = "novo" | "agendado" | "ativo" | "em_risco" | "inativo" | "perdido";

export type Client = {
  id: string;
  salon_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birth_date: string | null;
  gender: string | null;
  origin: ClientOrigin;
  tags: string[];
  notes: string | null;
  opt_out: boolean;
  lost_at: string | null;
  lost_reason: string | null;
  photo_consent_at: string | null;
  archived_at: string | null;
  created_at: string;
};

export type ClientOverview = Client & {
  visits_count: number;
  last_visit_at: string | null;
  total_spent: number | null;
  avg_frequency_days: number | null;
  next_appointment_at: string | null;
  next_return_at: string | null;
  lifecycle_status: LifecycleStatus;
};

export type TechNoteKind = "coloracao" | "cabelo" | "unhas" | "pele" | "alergia" | "geral";
export type ClientNote = {
  id: string;
  client_id: string;
  kind: TechNoteKind;
  title: string | null;
  body: string;
  data: Record<string, string>;
  professional_id: string | null;
  created_at: string;
};

export type ClientPhoto = {
  id: string;
  client_id: string;
  storage_path: string;
  kind: "antes" | "depois" | "referencia";
  caption: string | null;
  created_at: string;
};

export type AppointmentStatus =
  | "agendado" | "confirmado" | "em_atendimento" | "concluido" | "nao_compareceu" | "cancelado" | "reagendado";
export type AppointmentOrigin = "recepcao" | "link_online" | "whatsapp" | "profissional";

export type AppointmentItem = {
  id: string;
  appointment_id: string;
  service_id: string;
  professional_id: string;
  position: number;
  starts_at: string;
  ends_at: string;
  price: number;
  is_squeeze: boolean;
  occupies: boolean;
};

export type Appointment = {
  id: string;
  salon_id: string;
  client_id: string;
  status: AppointmentStatus;
  origin: AppointmentOrigin;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  rescheduled_from_id: string | null;
  rescheduled_to_id: string | null;
  cancel_reason: string | null;
  created_at: string;
  client?: Pick<Client, "id" | "name" | "phone">;
  items?: AppointmentItem[];
};

export type WaitlistEntry = {
  id: string;
  salon_id: string;
  client_id: string;
  service_id: string | null;
  professional_id: string | null;
  date_from: string;
  date_to: string | null;
  period: "manha" | "tarde" | "noite" | "qualquer";
  notes: string | null;
  status: "aguardando" | "agendado" | "desistiu";
  appointment_id: string | null;
  created_at: string;
  client?: Pick<Client, "id" | "name" | "phone">;
};

export type Invitation = {
  id: string;
  salon_id: string;
  email: string;
  role: SalonRole;
  full_name: string | null;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------
// Fase 2: comandas, caixa, estoque, pacotes e comissões
// ---------------------------------------------------------------------
export type PaymentKind = "dinheiro" | "pix" | "debito" | "credito" | "voucher" | "outro";

export type PaymentMethod = {
  id: string;
  salon_id: string;
  name: string;
  kind: PaymentKind;
  fee_pct: number;
  installment_fee_pct: number;
  max_installments: number;
  sort_order: number;
  active: boolean;
};

export type CashSession = {
  id: string;
  salon_id: string;
  opened_by: string | null;
  opened_at: string;
  opening_amount: number;
  closed_by: string | null;
  closed_at: string | null;
  expected_amount: number | null;
  counted_amount: number | null;
  difference: number | null;
  notes: string | null;
};

export type CashSessionSummary = {
  cash_session_id: string;
  salon_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: number;
  received_by_kind: Partial<Record<PaymentKind, number>>;
  received_total: number;
  fees_total: number;
  orders_count: number;
  suprimentos: number;
  sangrias: number;
  despesas: number;
  estornos: number;
  expected_cash: number;
  counted_amount: number | null;
  difference: number | null;
};

export type CashMovementKind = "suprimento" | "sangria" | "despesa" | "estorno";
export type CashMovement = {
  id: string;
  salon_id: string;
  cash_session_id: string;
  kind: CashMovementKind;
  amount: number;
  description: string;
  order_id: string | null;
  created_at: string;
};

export type OrderStatus = "aberta" | "fechada" | "cancelada";
export type OrderItemKind = "servico" | "produto" | "pacote";

export type Order = {
  id: string;
  salon_id: string;
  number: number;
  client_id: string | null;
  appointment_id: string | null;
  status: OrderStatus;
  subtotal: number;
  discount_amount: number;
  discount_reason: string | null;
  total: number;
  fee_total: number;
  notes: string | null;
  cash_session_id: string | null;
  opened_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  client?: { id: string; name: string; phone: string | null } | null;
};

export type OrderItem = {
  id: string;
  salon_id: string;
  order_id: string;
  kind: OrderItemKind;
  service_id: string | null;
  product_id: string | null;
  package_id: string | null;
  professional_id: string | null;
  appointment_item_id: string | null;
  client_package_balance_id: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  total: number;
  created_at: string;
};

export type OrderPayment = {
  id: string;
  order_id: string;
  payment_method_id: string;
  kind: PaymentKind;
  amount: number;
  installments: number;
  fee_amount: number;
  refunded_at: string | null;
  created_at: string;
};

export type ProductUnit = "un" | "ml" | "g";
export type Product = {
  id: string;
  salon_id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  unit: ProductUnit;
  package_size: number;
  for_sale: boolean;
  for_use: boolean;
  cost_price: number;
  sale_price: number;
  commission_pct: number;
  min_stock: number;
  current_stock: number;
  active: boolean;
};

export type StockMovementKind = "entrada" | "venda" | "uso" | "ajuste" | "perda" | "estorno";
export type StockMovement = {
  id: string;
  salon_id: string;
  product_id: string;
  kind: StockMovementKind;
  quantity: number;
  unit_cost: number | null;
  order_id: string | null;
  notes: string | null;
  created_at: string;
};

export type ServiceSupply = { salon_id: string; service_id: string; product_id: string; quantity: number };

export type Package = {
  id: string;
  salon_id: string;
  name: string;
  description: string | null;
  price: number;
  validity_days: number | null;
  active: boolean;
};
export type PackageItem = { salon_id: string; package_id: string; service_id: string; sessions: number };

export type ClientPackageBalance = {
  balance_id: string;
  client_package_id: string;
  salon_id: string;
  client_id: string;
  client_name: string;
  package_name: string;
  purchased_at: string;
  expires_at: string | null;
  status: "ativo" | "cancelado";
  service_id: string;
  service_name: string;
  sessions_total: number;
  sessions_used: number;
  sessions_left: number;
  usable: boolean;
};

export type CommissionStatus = "pendente" | "paga" | "estornada";
export type Commission = {
  id: string;
  salon_id: string;
  professional_id: string;
  order_id: string;
  order_item_id: string | null;
  order_number: number;
  description: string;
  competence_date: string;
  base_amount: number;
  pct: number;
  amount: number;
  status: CommissionStatus;
  reversal_of_id: string | null;
  payout_id: string | null;
  created_at: string;
};

export type CommissionPayout = {
  id: string;
  salon_id: string;
  professional_id: string;
  period_until: string;
  total: number;
  method: string | null;
  notes: string | null;
  paid_at: string;
};
