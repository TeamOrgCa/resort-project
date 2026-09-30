export type StaffRole = "admin" | "staff" | "cashier";

export interface StaffUserProfile {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  active_session_id: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
}

export interface StaffUserListItem extends StaffUserProfile {
  created_at: string;
  updated_at: string;
}

export interface StaffManagementResponse {
  success: true;
  message: string;
}

export const STAFF_SESSION_COOKIE = "staff_session_id";

export function isStaffRole(role: string): role is StaffRole {
  return role === "admin" || role === "staff" || role === "cashier";
}
