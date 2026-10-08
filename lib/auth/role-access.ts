import type { AdminNavItem } from "@/components/admin/types";
import type { StaffRole } from "./staff-auth";

export const PERMISSIONS = ["dashboard", "reservations", "create_reservation", "cancel_reservation", "reschedule_approval", "ocular_approval", "transactions", "payment_approval", "payment_entry", "refund_review", "refund_payout", "records", "reports", "analytics", "audit", "configuration", "catalog", "users"] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const PERMISSION_LABELS: Record<Permission, string> = {
  dashboard: "Dashboard", reservations: "View reservations", create_reservation: "Add reservation",
  cancel_reservation: "Cancel reservation", reschedule_approval: "Approve or reject reschedules",
  ocular_approval: "Approve or cancel ocular visits", transactions: "View transactions",
  payment_approval: "Approve or reject payments", payment_entry: "Record payments",
  refund_review: "Approve or reject refunds", refund_payout: "Record refund payout",
  records: "View records", reports: "View and export reports", analytics: "View analytics",
  audit: "View audit log", configuration: "Resort configuration", catalog: "Manage catalog",
  users: "Manage staff users",
};

export function hasPermission(role: StaffRole, granted: readonly string[], permission: Permission): boolean {
  return role === "admin" || granted.includes(permission);
}

export function routePermission(path: string): Permission | null {
  if (path === "/admin") return "dashboard";
  for (const [segment, permission] of [["users", "users"], ["configuration", "configuration"], ["catalog", "catalog"], ["transactions", "transactions"], ["reservations", "reservations"], ["manual-booking", "reservations"], ["records", "records"], ["reports", "reports"], ["analytics", "analytics"], ["audit", "audit"]] as const) {
    if (path === `/admin/${segment}` || path.startsWith(`/admin/${segment}/`)) return permission;
  }
  return null;
}

export function apiPermission(path: string, method: string): Permission | null {
  if (path.startsWith("/api/admin/auth/")) return null;
  if (path.startsWith("/api/admin/permissions") || path.startsWith("/api/admin/users")) return "users";
  if (path === "/api/admin/settings" && method === "GET") return null;
  if (path.startsWith("/api/admin/settings") || path.startsWith("/api/admin/booking-policy")) return "configuration";
  if (path.startsWith("/api/admin/catalog") || path.startsWith("/api/admin/payment-accounts")) return "catalog";
  if (path.startsWith("/api/admin/maintenance-blocks")) return method === "GET" ? "reservations" : "configuration";
  if (path.startsWith("/api/admin/reservations/create")) return "create_reservation";
  if (path.startsWith("/api/admin/reservations/cancel")) return "cancel_reservation";
  if (path.startsWith("/api/admin/reschedule-requests")) return "reschedule_approval";
  if (path.startsWith("/api/admin/ocular-visits")) return "ocular_approval";
  if (path.startsWith("/api/admin/payments/manual-entry")) return "payment_entry";
  if (path.startsWith("/api/admin/payments/")) return "payment_approval";
  if (path.startsWith("/api/admin/refunds")) return "transactions";
  if (path.startsWith("/api/admin/analytics")) return "analytics";
  if (path.startsWith("/api/admin/reports")) return "reports";
  if (path.startsWith("/api/admin/audit")) return "audit";
  return "users";
}

export function filterNavigationByRole(navigation: AdminNavItem[], role: StaffRole, granted: readonly string[]): AdminNavItem[] {
  return navigation.filter((item) => {
    const permission = routePermission(item.href);
    return permission !== null && hasPermission(role, granted, permission);
  });
}

export function getDefaultRouteForRole(role: StaffRole, granted: readonly string[]): string {
  const paths = ["/admin", "/admin/reservations", "/admin/transactions", "/admin/records", "/admin/reports", "/admin/analytics", "/admin/configuration", "/admin/catalog", "/admin/audit", "/admin/users"];
  return paths.find((path) => hasPermission(role, granted, routePermission(path)!)) ?? "/staff/no-access";
}
