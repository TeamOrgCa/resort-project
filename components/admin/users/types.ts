import type { StaffRole } from "@/lib/auth/staff-auth";

export interface StaffUserRecord {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  active_session_id: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StaffUserTableRow {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  status: string;
  lastLogin: string;
  createdAt: string;
  [key: string]: string | StaffRole;
}

export interface StaffUserFormValues {
  fullName: string;
  email: string;
  role: StaffRole;
  password: string;
  isActive: boolean;
}
