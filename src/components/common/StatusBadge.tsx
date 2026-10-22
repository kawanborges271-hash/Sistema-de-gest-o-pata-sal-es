import { cn } from "@/lib/utils";
import { LIFECYCLE_LABEL, LIFECYCLE_STYLE, STATUS_LABEL, STATUS_STYLE } from "@/lib/agenda";
import { ORDER_STATUS_LABEL, ORDER_STATUS_STYLE } from "@/lib/finance";
import type { AppointmentStatus, LifecycleStatus, OrderStatus } from "@/lib/types";

const base = "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium";

export function StatusBadge({ status, className }: { status: AppointmentStatus; className?: string }) {
  return <span className={cn(base, STATUS_STYLE[status], className)}>{STATUS_LABEL[status]}</span>;
}

export function LifecycleBadge({ status }: { status: LifecycleStatus }) {
  return <span className={cn(base, LIFECYCLE_STYLE[status])}>{LIFECYCLE_LABEL[status]}</span>;
}

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return <span className={cn(base, "border", ORDER_STATUS_STYLE[status], className)}>{ORDER_STATUS_LABEL[status]}</span>;
}
