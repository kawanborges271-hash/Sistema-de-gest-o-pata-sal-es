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
