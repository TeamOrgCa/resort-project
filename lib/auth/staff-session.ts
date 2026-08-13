import { STAFF_SESSION_COOKIE } from "@/lib/auth/staff-auth";

export function getStaffSessionTokenFromCookieStore(cookieStore: {
  get(name: string): { value: string } | undefined;
}) {
  return cookieStore.get(STAFF_SESSION_COOKIE)?.value ?? null;
}

export function createStaffSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}