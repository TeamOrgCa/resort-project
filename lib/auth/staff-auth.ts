export type StaffRole = "admin" | "staff" | "cashier";

export interface StaffLoginPayload {
  email: string;
  password: string;
}

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

export interface StaffAuthSuccessResponse {
  success: true;
  message: string;
  staffUser: {
    id: string;
    fullName: string;
    email: string;
    role: StaffRole;
  };
}

export interface StaffManagementResponse {
  success: true;
  message: string;
}

export interface StaffAuthErrorResponse {
  success: false;
  message: string;
}

export function parseStaffLoginPayload(payload: unknown): StaffLoginPayload | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const maybeEmail = "email" in payload ? payload.email : null;
  const maybePassword = "password" in payload ? payload.password : null;

  if (typeof maybeEmail !== "string" || typeof maybePassword !== "string") {
    return null;
  }

  const email = maybeEmail.trim().toLowerCase();
  const password = maybePassword;

  if (!email || !password || password.length < 6) {
    return null;
  }

  return { email, password };
}

export const STAFF_SESSION_COOKIE = "staff_session_id";

export function isStaffRole(role: string): role is StaffRole {
  return role === "admin" || role === "staff" || role === "cashier";
}
