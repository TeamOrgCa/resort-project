import type { AdminNavItem } from "@/components/admin/types";
import type { StaffRole } from "./staff-auth";

export const PERMISSIONS = ["rooms", "room_operations", "room_export", "dashboard", "reservations", "create_reservation", "edit_reservation", "cancel_reservation", "reschedule_approval", "ocular_approval", "transactions", "payment_approval", "payment_entry", "refund_approval", "refund_payout", "refund_verify", "records", "reports", "analytics", "feedback_archive", "feedback_moderation", "audit", "configuration", "catalog", "users"] as const;
export type Permission = (typeof PERMISSIONS)[number];
export const PERMISSION_LABELS: Record<Permission, string> = {
  rooms: "View room occupancy and history", room_operations: "Manage room stays, housekeeping and maintenance", room_export: "Export room records",
  dashboard: "Dashboard", reservations: "View reservations", create_reservation: "Add reservation",
  edit_reservation: "Edit reservations and services",
  cancel_reservation: "Cancel reservation", reschedule_approval: "Resolve legacy reschedules",
  ocular_approval: "Manage ocular visits and record attendance", transactions: "View transactions",
  payment_approval: "Approve or reject payments", payment_entry: "Record payments",
  refund_approval: "Approve or reject refunds (manager or admin)", refund_payout: "Record refund payout (cashier or admin)", refund_verify: "Verify refund payout (manager or admin)",
  records: "View records", reports: "View and export reports", analytics: "View analytics",
  feedback_archive: "Archive and restore guest feedback (also requires Analytics)",
  feedback_moderation: "Approve or reject reviews with attachments (also requires Analytics)",
  audit: "View audit log", configuration: "Resort configuration", catalog: "Manage catalog",
  users: "Manage staff and guest accounts (admin only)",
};

export function isPermissionAssignable(role: StaffRole, permission: Permission): boolean {
  if (role === "admin") return false;
  if (["users", "configuration", "catalog"].includes(permission)) return false;
  if (["room_operations", "room_export"].includes(permission) && role !== "staff") return false;
  if (["refund_approval", "refund_verify"].includes(permission) && role !== "staff") return false;
  if (permission === "refund_payout" && role !== "cashier") return false;
  if (permission === "feedback_moderation" && role !== "staff") return false;
  return PERMISSIONS.includes(permission);
}

export function hasPermission(role: StaffRole, granted: readonly string[], permission: Permission): boolean {
  if (role === "admin") return ADMIN_PERMISSIONS.includes(permission);
  return isPermissionAssignable(role, permission) && granted.includes(permission);
}

export const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS;

export function isAdminReadOnlyRequest(_role: StaffRole, _path: string, _method: string): boolean {
  // Access is enforced by route permissions; admins have every permission.
  return false;
}

export function routePermission(path: string): Permission | null {
  if (path === "/admin/rooms/settings") return "configuration";
  if (path === "/admin/rooms" || path.startsWith("/admin/rooms/")) return "rooms";
  if (path === "/admin") return "dashboard";
  for (const [segment, permission] of [["users", "users"], ["configuration", "configuration"], ["catalog", "catalog"], ["transactions", "transactions"], ["reservations", "reservations"], ["manual-booking", "reservations"], ["records", "records"], ["reports", "reports"], ["analytics", "analytics"], ["audit", "audit"]] as const) {
    if (path === `/admin/${segment}` || path.startsWith(`/admin/${segment}/`)) return permission;
  }
  return null;
}

export function apiPermission(path: string, method: string): Permission | null {
  if (path.startsWith("/api/admin/rooms")) return "rooms"; // Individual operations enforce their additional permission.
  if (path.startsWith("/api/admin/auth/")) return null;
  if (path.startsWith("/api/admin/booking-discounts")) return null; // Endpoint enforces manager edit or cashier billing permissions.
  if (path === "/api/admin/dashboard") return "dashboard";
  if (path.startsWith("/api/admin/permissions") || path.startsWith("/api/admin/users")) return "users";
  if (path === "/api/admin/settings" && method === "GET") return null;
  if (path.startsWith("/api/admin/settings") || path.startsWith("/api/admin/booking-policy") || path.startsWith("/api/admin/swimming-sessions")) return "configuration";
  if (path.startsWith("/api/admin/catalog") || path.startsWith("/api/admin/payment-accounts")) return "catalog";
  if (path.startsWith("/api/admin/maintenance-blocks")) return "reservations";
  if (path.startsWith("/api/admin/reservations/create")) return "create_reservation";
  if (path === "/api/admin/reservations/public-swimming") return "create_reservation";
  if (path.startsWith("/api/admin/records/")) return "records";
  if (path === "/api/admin/reservations/check-in") return "edit_reservation";
  if (path === "/api/admin/reservations/check-out") return "edit_reservation";
  if (path === "/api/admin/reservations/no-show") return "edit_reservation";
  if (path.startsWith("/api/admin/reservations/cancel")) return "cancel_reservation";
  if (/^\/api\/admin\/reservations\/[\da-f-]+$/i.test(path)) return method === "GET" ? "reservations" : "edit_reservation";
  if (path.startsWith("/api/admin/reschedule-requests")) return "reschedule_approval";
  if (path.startsWith("/api/admin/ocular-visits")) return "ocular_approval";
  if (path.startsWith("/api/admin/payments/manual-entry")) return "payment_entry";
  if (path.startsWith("/api/admin/public-access-sales")) return "payment_entry";
  if (path.startsWith("/api/admin/payments/")) return "payment_approval";
  if (path.startsWith("/api/admin/refunds")) return "transactions";
  if (path === "/api/admin/transactions/guest-report") return "reports";
  if (path.startsWith("/api/admin/transactions/")) return "transactions";
  if (path === "/api/admin/analytics/feedback/moderate") return "feedback_moderation";
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
  const paths = ["/admin", "/admin/reservations", "/admin/rooms", "/admin/transactions", "/admin/records", "/admin/reports", "/admin/analytics", "/admin/configuration", "/admin/catalog", "/admin/audit", "/admin/users"];
  return paths.find((path) => hasPermission(role, granted, routePermission(path)!)) ?? "/staff/no-access";
}
