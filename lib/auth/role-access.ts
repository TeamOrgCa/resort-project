import type { AdminNavItem } from "@/components/admin/types";
import type { StaffRole } from "./staff-auth";

export const PERMISSIONS = ["dashboard", "reservations", "create_reservation", "edit_reservation", "cancel_reservation", "reschedule_approval", "ocular_approval", "transactions", "payment_approval", "payment_entry", "refund_approval", "refund_payout", "refund_verify", "records", "reports", "analytics", "feedback_archive", "audit", "configuration", "catalog", "users"] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const PERMISSION_LABELS: Record<Permission, string> = {
  dashboard: "Dashboard", reservations: "View reservations", create_reservation: "Add reservation",
  edit_reservation: "Edit reservations and services",
  cancel_reservation: "Cancel reservation", reschedule_approval: "Approve or reject reschedules",
  ocular_approval: "Manage ocular visits and record attendance", transactions: "View transactions",
  payment_approval: "Approve or reject payments", payment_entry: "Record payments",
  refund_approval: "Approve or reject refunds (manager only)", refund_payout: "Record refund payout (cashier only)", refund_verify: "Verify refund payout (manager only)",
  records: "View records", reports: "View and export reports", analytics: "View analytics",
  feedback_archive: "Archive and restore guest feedback (also requires Analytics)",
  audit: "View audit log", configuration: "Resort configuration", catalog: "Manage catalog",
  users: "Manage staff and guest accounts (admin only)",
};

export function isPermissionAssignable(role: StaffRole, permission: Permission): boolean {
  if (role === "admin") return false;
  if (["users", "configuration", "catalog"].includes(permission)) return false;
  if (["refund_approval", "refund_verify"].includes(permission) && role !== "staff") return false;
  if (permission === "refund_payout" && role !== "cashier") return false;
  return PERMISSIONS.includes(permission);
}

export function hasPermission(role: StaffRole, granted: readonly string[], permission: Permission): boolean {
  if (role === "admin") return ADMIN_PERMISSIONS.includes(permission);
  return isPermissionAssignable(role, permission) && granted.includes(permission);
}

export const ADMIN_PERMISSIONS: readonly Permission[] = ["dashboard", "reservations", "transactions", "records", "reports", "analytics", "audit", "users", "configuration", "catalog"];

export function isAdminReadOnlyRequest(role: StaffRole, path: string, method: string): boolean {
  if (role !== "admin" || ["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return false;
  const fullAccessPaths = ["/api/admin/users", "/api/admin/permissions", "/api/admin/settings", "/api/admin/booking-policy", "/api/admin/catalog", "/api/admin/payment-accounts", "/api/admin/auth"];
  return !fullAccessPaths.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
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
  if (path === "/api/admin/dashboard") return "dashboard";
  if (path.startsWith("/api/admin/permissions") || path.startsWith("/api/admin/users")) return "users";
  if (path === "/api/admin/settings" && method === "GET") return null;
  if (path.startsWith("/api/admin/settings") || path.startsWith("/api/admin/booking-policy")) return "configuration";
  if (path.startsWith("/api/admin/catalog") || path.startsWith("/api/admin/payment-accounts")) return "catalog";
  if (path.startsWith("/api/admin/maintenance-blocks")) return "reservations";
  if (path.startsWith("/api/admin/reservations/create")) return "create_reservation";
  if (path.startsWith("/api/admin/records/")) return "records";
  if (path === "/api/admin/reservations/check-in") return "edit_reservation";
  if (path === "/api/admin/reservations/check-out") return "edit_reservation";
  if (path === "/api/admin/reservations/no-show") return "edit_reservation";
  if (path.startsWith("/api/admin/reservations/cancel")) return "cancel_reservation";
  if (/^\/api\/admin\/reservations\/[\da-f-]+$/i.test(path)) return method === "GET" ? "reservations" : "edit_reservation";
  if (path.startsWith("/api/admin/reschedule-requests")) return "reschedule_approval";
  if (path.startsWith("/api/admin/ocular-visits")) return "ocular_approval";
  if (path.startsWith("/api/admin/payments/manual-entry")) return "payment_entry";
  if (path.startsWith("/api/admin/payments/")) return "payment_approval";
  if (path.startsWith("/api/admin/refunds")) return "transactions";
  if (path === "/api/admin/transactions/guest-report") return "reports";
  if (path.startsWith("/api/admin/transactions/")) return "transactions";
  if (path.startsWith("/api/admin/analytics/feedback") && method === "PATCH") return "feedback_archive";
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
  if (role === "admin") return "/admin/users";
  const paths = ["/admin", "/admin/reservations", "/admin/transactions", "/admin/records", "/admin/reports", "/admin/analytics", "/admin/configuration", "/admin/catalog", "/admin/audit", "/admin/users"];
  return paths.find((path) => hasPermission(role, granted, routePermission(path)!)) ?? "/staff/no-access";
}
