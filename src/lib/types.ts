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
  suspended_reason: string | null;
  plan_id: string;
  app_url: string | null;
  google_review_url: string | null;
  wa_window_start: string;
  wa_window_end: string;
  wa_daily_limit: number;
  wa_spacing_seconds: number;
  online_booking_enabled: boolean;
  online_booking_min_hours: number;
  online_booking_max_days: number;
  online_booking_step_minutes: number;
  online_booking_message: string | null;
  loyalty_enabled: boolean;
  loyalty_points_per_real: number;
  referral_enabled: boolean;
  referral_credit: number;
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
  referred_by_client_id: string | null;
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
  no_show_at: string | null;
  reschedule_requested_at: string | null;
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
  loyalty_credit: boolean;
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
  loyalty_reward_id: string | null;
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

// ---------------------------------------------------------------------
// Fase 3: CRM, WhatsApp e agendamento online
// ---------------------------------------------------------------------
export type LeadStage = "novo" | "em_contato" | "agendado" | "follow_up" | "cliente" | "nao_compareceu" | "base_fria" | "perdido";

export type Lead = {
  id: string;
  salon_id: string;
  client_id: string | null;
  name: string;
  phone: string | null;
  origin: ClientOrigin;
  stage: LeadStage;
  stage_changed_at: string;
  interest: string | null;
  notes: string | null;
  next_follow_up_at: string | null;
  lost_reason: string | null;
  last_message: string | null;
  last_message_at: string | null;
  last_message_direction: "in" | "out" | null;
  converted_at: string | null;
  archived_at: string | null;
  created_at: string;
};

export type LeadStageHistory = {
  id: number;
  lead_id: string;
  from_stage: LeadStage | null;
  to_stage: LeadStage;
  reason: string | null;
  automatic: boolean;
  changed_by: string | null;
  changed_at: string;
};

export type AutomationKind =
  | "confirmacao_agendamento" | "lembrete_24h" | "confirmacao_2h" | "reagendamento" | "cancelamento"
  | "pos_atendimento" | "avaliacao_google" | "retoque" | "recuperacao_falta" | "aniversario"
  | "reativacao" | "pacote_acabando";

export type Automation = {
  id: string;
  salon_id: string;
  kind: AutomationKind;
  enabled: boolean;
  template: string;
  settings: Record<string, string | number>;
  updated_at: string;
};

export type MessageKind = AutomationKind | "campanha" | "manual" | "resposta" | "teste";
export type QueueStatus = "pendente" | "enviando" | "enviada" | "falhou" | "cancelada" | "ignorada" | "expirada";

export type QueuedMessage = {
  id: string;
  salon_id: string;
  client_id: string | null;
  lead_id: string | null;
  appointment_id: string | null;
  campaign_id: string | null;
  phone: string;
  body: string;
  kind: MessageKind;
  status: QueueStatus;
  scheduled_for: string;
  expires_at: string | null;
  attempts: number;
  sent_at: string | null;
  last_error: string | null;
  created_at: string;
  client?: { name: string } | null;
  lead?: { name: string } | null;
};

export type WhatsappMessage = {
  id: string;
  direction: "in" | "out";
  phone: string;
  client_id: string | null;
  lead_id: string | null;
  body: string;
  sender_name: string | null;
  created_at: string;
};

export type OptOut = { salon_id: string; phone: string; reason: "palavra_chave" | "manual"; source_message: string | null; created_at: string };

export type Campaign = {
  id: string;
  name: string;
  body: string;
  audience: string;
  scheduled_for: string;
  recipients_count: number;
  created_at: string;
};

export type ClientFeedback = { id: string; client_id: string | null; appointment_id: string | null; score: number; created_at: string; client?: { name: string } | null };

export type AppNotification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read: boolean;
};

export type WhatsappIntegrationStatus = {
  configured: boolean;
  active: boolean;
  instance_id: string | null;
  phone: string | null;
  status: "pendente" | "conectado" | "desconectado" | "erro";
  token_hint: string | null;
  client_token_set: boolean;
  webhook_secret: string;
  last_checked_at: string | null;
  last_error: string | null;
  connected_at: string | null;
};

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  duration_minutes: number;
  price: number;
  price_is_starting: boolean;
};
export type PublicProfessional = { id: string; name: string; role_title: string | null; color: string; service_ids: string[] };
export type PublicSalon = {
  name: string;
  slug: string;
  whatsapp: string | null;
  address: string | null;
  timezone: string;
  min_hours: number;
  max_days: number;
  message: string | null;
  business_hours: BusinessHours;
  services: PublicService[];
  professionals: PublicProfessional[];
};
export type PublicSlot = { starts_at: string; ends_at: string; professional_id: string; professional_name: string };
export type PublicBooking = {
  appointment_id: string;
  starts_at: string;
  ends_at: string;
  professional_name: string;
  services: string;
  total: number;
  salon_name: string;
};

// ---------------------------------------------------------------------
// Fase 4: dashboard, marketing, inteligência e fidelidade
// ---------------------------------------------------------------------
export type PeriodMetrics = {
  from: string;
  to: string;
  revenue: number;
  orders: number;
  avg_ticket: number | null;
  appointments: number;
  attended: number;
  no_shows: number;
  attendance_rate: number | null;
  booked_hours: number;
  available_hours: number;
  occupancy: number | null;
  new_clients: number;
  returning_clients: number;
  product_revenue: number;
  product_share: number | null;
  commissions: number;
};

export type DashboardSummary = {
  current: PeriodMetrics;
  previous: PeriodMetrics;
  granularity: "dia" | "semana";
  series: { bucket: string; current: number; previous: number }[];
  upcoming: { id: string; starts_at: string; status: AppointmentStatus; client_name: string; services: string | null; professional: string | null }[];
  birthdays: { id: string; name: string; phone: string | null; date: string; age: number }[];
};

export type MarketingChannel = "meta_ads" | "google" | "instagram" | "indicacao";

export type MarketingRow = {
  month: string;
  channel: MarketingChannel;
  has_entry: boolean;
  investment: number;
  leads: number | null;
  appointments: number | null;
  sales: number | null;
  revenue: number | null;
  auto_leads: number | null;
  auto_appointments: number | null;
  auto_sales: number | null;
  auto_revenue: number | null;
  notes: string | null;
};

export type MarketingEntry = {
  id: string;
  salon_id: string;
  month: string;
  channel: MarketingChannel;
  investment: number;
  leads: number | null;
  appointments: number | null;
  sales: number | null;
  revenue: number | null;
  notes: string | null;
};

export type IntelAction = {
  key: string;
  rank: number;
  count: number;
  impact: number;
  title: string;
  detail: string;
  action: { type: "link"; to: string; label: string } | { type: "campaign"; audience: string; label: string; date?: string };
};

export type IntelProfessional = {
  professional_id: string;
  name: string;
  color: string;
  appointments: number;
  attended: number;
  no_shows: number;
  attendance_rate: number | null;
  revenue: number;
  orders: number;
  avg_ticket: number | null;
  product_revenue: number;
  clients: number;
  returned: number;
  return_rate: number | null;
};

export type IntelReport = {
  from: string;
  to: string;
  days: number;
  services: { service_id: string; name: string; sales: number; revenue: number; avg_ticket: number }[];
  no_shows: { weekday: number; total: number; no_shows: number; rate: number | null }[];
  heatmap: { weekday: number; hour: number; available: number; booked: number; rate: number | null }[];
  professionals: IntelProfessional[];
};

export type LoyaltyReward = {
  id: string;
  salon_id: string;
  service_id: string;
  points_cost: number;
  active: boolean;
  service?: { name: string; price: number } | null;
};

export type LoyaltyReason = "compra" | "resgate" | "indicacao" | "uso_credito" | "estorno" | "ajuste";

export type LoyaltyMovement = {
  id: string;
  client_id: string;
  kind: "pontos" | "credito";
  amount: number;
  reason: LoyaltyReason;
  order_id: string | null;
  note: string | null;
  created_at: string;
  client?: { name: string } | null;
};

export type LoyaltyBalance = { salon_id: string; client_id: string; name: string; points: number; credit: number; last_movement_at: string | null };

export type LoyaltySummary = {
  clients_with_points: number;
  points_outstanding: number;
  credit_outstanding: number;
  points_30d: number;
  redeemed_30d: number;
  referrals_total: number;
  referrals_converted: number;
};

// ---------------------------------------------------------------------
// Fase 5: Painel SaaS
// ---------------------------------------------------------------------
export type Plan = {
  id: string;
  name: string;
  max_professionals: number | null;
  max_messages_month: number | null;
  sort_order: number;
};

export type PlanUsage = {
  plan_id: string;
  plan_name: string;
  max_professionals: number | null;
  professionals: number;
  max_messages_month: number | null;
  messages_month: number;
};

export type PlatformOverview = {
  salons: number;
  active: number;
  suspended: number;
  new_30d: number;
  users: number;
  by_plan: Record<string, number>;
  whatsapp_connected: number;
  appointments_30d: number;
};

/** Uso de um salão no painel: só contagens e datas, nunca valores. */
export type PlatformSalon = {
  id: string;
  name: string;
  slug: string;
  plan_id: string;
  plan_name: string;
  created_at: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  onboarding_completed: boolean;
  owner_name: string | null;
  owner_email: string | null;
  team: number;
  professionals: number;
  max_professionals: number | null;
  clients: number;
  appointments_30d: number;
  leads_30d: number;
  messages_month: number;
  max_messages_month: number | null;
  whatsapp_status: "pendente" | "conectado" | "desconectado" | "erro" | "desligado" | null;
  online_booking: boolean;
  last_activity_at: string | null;
  last_login_at: string | null;
};

export type PlatformMember = {
  member_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: SalonRole;
  active: boolean;
  joined_at: string;
  last_sign_in_at: string | null;
};

export type PlatformUser = {
  user_id: string;
  full_name: string | null;
  email: string;
  last_sign_in_at: string | null;
  memberships: { salon_id: string; salon_name: string; role: SalonRole; active: boolean }[];
};

export type PlatformAuditRow = {
  id: number;
  created_at: string;
  action: string;
  actor_name: string | null;
  salon_name: string | null;
  target_email: string | null;
  details: Record<string, unknown>;
};
