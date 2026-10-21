import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { ClientPackageBalance, Package, PackageItem, Product, ServiceSupply, StockMovement, StockMovementKind } from "@/lib/types";

function useSalonId() {
  return useAuth().salon?.id;
}

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data as T;
}

// ---------------------------------------------------------------------
// Produtos e estoque
// ---------------------------------------------------------------------
export function useProducts() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["products", salonId],
    enabled: Boolean(salonId),
    queryFn: () => unwrap<Product[]>(supabase.from("products").select("*").eq("salon_id", salonId!).order("name")),
  });
}

type ProductInput = Omit<Partial<Product>, "current_stock" | "salon_id"> & { id?: string };

export function useSaveProduct() {
  const salonId = useSalonId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...p }: ProductInput & { initial_stock?: number }) => {
      const { initial_stock, ...fields } = p;
      if (id) {
        const { error } = await supabase.from("products").update(fields).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await supabase.from("products").insert({ ...fields, salon_id: salonId }).select("id").single();
      if (error) throw error;
      if (initial_stock && initial_stock > 0) {
        const r = await supabase.from("stock_movements").insert({
          salon_id: salonId, product_id: data.id, kind: "entrada", quantity: initial_stock, notes: "Estoque inicial",
        });
        if (r.error) throw r.error;
      }
      return data.id as string;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["products"] }), qc.invalidateQueries({ queryKey: ["stock_movements"] })]),
  });
}

export function useStockMovements(productId?: string, limit = 100) {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["stock_movements", salonId, productId ?? "all", limit],
    enabled: Boolean(salonId),
    queryFn: () => {
      let q = supabase.from("stock_movements").select("*").eq("salon_id", salonId!);
      if (productId) q = q.eq("product_id", productId);
      return unwrap<StockMovement[]>(q.order("created_at", { ascending: false }).limit(limit));
    },
  });
}

export function useAddStockMovement() {
  const salonId = useSalonId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (m: { product_id: string; kind: Extract<StockMovementKind, "entrada" | "ajuste" | "perda">; quantity: number; notes?: string; unit_cost?: number }) => {
      const { error } = await supabase.from("stock_movements").insert({ ...m, salon_id: salonId });
      if (error) throw error;
    },
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ["products"] }), qc.invalidateQueries({ queryKey: ["stock_movements"] })]),
  });
}

export function useServiceSupplies(serviceId?: string) {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["service_supplies", salonId, serviceId ?? "all"],
    enabled: Boolean(salonId),
    queryFn: () => {
      let q = supabase.from("service_supplies").select("*").eq("salon_id", salonId!);
      if (serviceId) q = q.eq("service_id", serviceId);
      return unwrap<ServiceSupply[]>(q);
    },
  });
}

/** Substitui a lista de produtos usados por um serviço. */
export function useSaveServiceSupplies() {
  const salonId = useSalonId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ serviceId, supplies }: { serviceId: string; supplies: { product_id: string; quantity: number }[] }) => {
      const del = await supabase.from("service_supplies").delete().eq("service_id", serviceId);
      if (del.error) throw del.error;
      if (supplies.length) {
        const { error } = await supabase.from("service_supplies")
          .insert(supplies.map((s) => ({ ...s, salon_id: salonId, service_id: serviceId })));
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["service_supplies"] }),
  });
}

// ---------------------------------------------------------------------
// Pacotes
// ---------------------------------------------------------------------
export type PackageWithItems = Package & { items: PackageItem[] };

export function usePackages() {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["packages", salonId],
    enabled: Boolean(salonId),
    queryFn: () =>
      unwrap<PackageWithItems[]>(supabase.from("packages").select("*, items:package_items(*)").eq("salon_id", salonId!).order("name")),
  });
}

export function useSavePackage() {
  const salonId = useSalonId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, items, ...p }: Partial<Package> & { id?: string; items: { service_id: string; sessions: number }[] }) => {
      let pid = id;
      if (pid) {
        const { error } = await supabase.from("packages").update(p).eq("id", pid);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("packages").insert({ ...p, salon_id: salonId }).select("id").single();
        if (error) throw error;
        pid = data.id as string;
      }
      const del = await supabase.from("package_items").delete().eq("package_id", pid);
      if (del.error) throw del.error;
      if (items.length) {
        const { error } = await supabase.from("package_items").insert(items.map((i) => ({ ...i, salon_id: salonId, package_id: pid })));
        if (error) throw error;
      }
      return pid;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["packages"] }),
  });
}

/** Saldo de pacotes de uma cliente (ou de todas, para a tela de Pacotes). */
export function useClientPackages(clientId?: string) {
  const salonId = useSalonId();
  return useQuery({
    queryKey: ["client_packages", salonId, clientId ?? "all"],
    enabled: Boolean(salonId),
    queryFn: () => {
      let q = supabase.from("client_package_overview").select("*").eq("salon_id", salonId!);
      if (clientId) q = q.eq("client_id", clientId);
      return unwrap<ClientPackageBalance[]>(q.order("purchased_at", { ascending: false }));
    },
  });
}
