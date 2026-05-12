import type { AdminNavItem } from "@/components/admin/types";
import type { StaffRole } from "./staff-auth";

/**
 * Define which modules each role can access
 */
const roleAccessMap: Record<StaffRole, string[]> = {
  admin: [
    "/admin",
    "/admin/reservations",
    "/admin/schedules",
    "/admin/transactions",
    "/admin/reports",
    "/admin/analytics",
    "/admin/users",
    "/admin/audit",
  ],
  staff: [
    "/admin",
    "/admin/reservations",
    "/admin/schedules",
    "/admin/transactions",
    "/admin/reports",
    "/admin/analytics",
    "/admin/users",
    "/admin/audit",
  ],
  cashier: ["/admin/reservations", "/admin/transactions"],
};

/**
 * Check if a role can access a specific route
 */
export function canAccessRoute(role: StaffRole, route: string): boolean {
  if (role === "admin") {
    return true;
  }
  const allowedRoutes = roleAccessMap[role];
  return allowedRoutes.some(
    (allowedRoute) =>
      route === allowedRoute || route.startsWith(allowedRoute + "/")
  );
}

/**
 * Filter navigation items based on role
 */
export function filterNavigationByRole(
  navigation: AdminNavItem[],
  role: StaffRole
): AdminNavItem[] {
  if (role === "admin") {
    return navigation;
  }
  const allowedRoutes = roleAccessMap[role];
  return navigation.filter((item) =>
    allowedRoutes.some((route) => item.href === route)
  );
}

/**
 * Get the first accessible route for a role (for redirect)
 */
export function getDefaultRouteForRole(role: StaffRole): string {
  const allowedRoutes = roleAccessMap[role];
  return allowedRoutes[0] ?? "/admin/login";
}

/**
 * Check if a role is admin
 */
export function isAdmin(role: StaffRole): boolean {
  return role === "admin";
}

/**
 * Check if a role is cashier
 */
export function isCashier(role: StaffRole): boolean {
  return role === "cashier";
}
