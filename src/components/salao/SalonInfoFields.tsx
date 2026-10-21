import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Salon } from "@/lib/types";

export type SalonInfo = Pick<Salon,
  "name" | "whatsapp" | "email" | "address_street" | "address_number" | "address_district" | "address_city" | "address_state" | "address_zip">;

export function salonInfoFrom(s: Salon | null): SalonInfo {
  return {
    name: s?.name ?? "", whatsapp: s?.whatsapp ?? "", email: s?.email ?? "",
    address_street: s?.address_street ?? "", address_number: s?.address_number ?? "", address_district: s?.address_district ?? "",
    address_city: s?.address_city ?? "", address_state: s?.address_state ?? "", address_zip: s?.address_zip ?? "",
  };
}

export function SalonInfoFields({ value, onChange }: { value: SalonInfo; onChange: (v: SalonInfo) => void }) {
  const f = (k: keyof SalonInfo, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`salon-${k}`}>{label}</Label>
      <Input id={`salon-${k}`} value={value[k] ?? ""} onChange={(e) => onChange({ ...value, [k]: e.target.value })} {...props} />
    </div>
  );
  return (
    <div className="space-y-3">
      {f("name", "Nome do salão")}
      <div className="grid gap-3 sm:grid-cols-2">
        {f("whatsapp", "WhatsApp do salão", { placeholder: "(11) 99999-9999" })}
        {f("email", "E-mail", { type: "email" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_110px]">
        {f("address_street", "Rua")}
        {f("address_number", "Número")}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_80px_120px]">
        {f("address_district", "Bairro")}
        {f("address_city", "Cidade")}
        {f("address_state", "UF", { maxLength: 2 })}
        {f("address_zip", "CEP")}
      </div>
    </div>
  );
}
