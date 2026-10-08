import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getAuthSessionId } from "@/lib/auth/auth-session";
import { getStaffSessionTokenFromCookieStore } from "@/lib/auth/staff-session";

export const DEVICE_COOKIE = "resort_device_id";
const DEVICE_COOKIE_AGE = 60 * 60 * 24 * 365;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDeviceId(value: string | undefined): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

export type LoginKind = "guest" | "staff";

export function parseCredentials(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const { email, password } = value as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string") return null;
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || normalizedEmail.length > 320 || !password) return null;
  return { email: normalizedEmail, password };
}

export async function loginAccess(kind: LoginKind, body: unknown) {
  const credentials = parseCredentials(body);
  if (!credentials) return { response: loginError("Please provide a valid email and password.", 400) };

  const admin = createAdminClient();
  const supabase = await createClient();
  const cookieStore = await cookies();
  const existingDevice = cookieStore.get(DEVICE_COOKIE)?.value;
  const deviceId = isDeviceId(existingDevice)
    ? existingDevice : crypto.randomUUID();
  const finish = (response: NextResponse) => {
    if (deviceId !== existingDevice) response.cookies.set(DEVICE_COOKIE, deviceId, {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: DEVICE_COOKIE_AGE,
    });
    return response;
  };

  const { data: state, error: stateError } = await admin.rpc("check_login_lock", { p_email: credentials.email });
  if (stateError) throw stateError;
  if (state && new Date(state).getTime() > Date.now()) {
    await recordAttempt(admin, credentials.email, deviceId, kind, "blocked");
    return { response: finish(loginError("Too many attempts. Try again in one minute.", 429)) };
  }

  const { data: { user: existingUser } } = await supabase.auth.getUser();
  if (existingUser && existingUser.email?.toLowerCase() !== credentials.email) {
    const [{ data: currentStaff }, { data: currentGuest }, { data: { session } }] = await Promise.all([
      admin.from("staff_users").select("active_session_id, is_active").eq("id", existingUser.id).maybeSingle(),
      admin.from("guests").select("active_session_id").eq("id", existingUser.id).maybeSingle(),
      supabase.auth.getSession(),
    ]);
    const staffToken = getStaffSessionTokenFromCookieStore(cookieStore);
    const guestToken = getAuthSessionId(session?.access_token);
    const active = currentStaff
      ? Boolean(currentStaff.is_active && staffToken && currentStaff.active_session_id === staffToken)
      : Boolean(currentGuest && guestToken && currentGuest.active_session_id === guestToken);
    if (active) {
      await recordAttempt(admin, credentials.email, deviceId, kind, "device_conflict");
      return { response: finish(loginError("Sign out of the current account before signing in to another.", 409)) };
    }
    await supabase.auth.signOut({ scope: "local" });
  }

  const { data, error } = await supabase.auth.signInWithPassword(credentials);
  if (error || !data.user) {
    const lockedUntil = await recordAttempt(admin, credentials.email, deviceId, kind, "failed");
    return { response: finish(loginError(lockedUntil ? "Too many attempts. Try again in one minute." : "Invalid credentials.", lockedUntil ? 429 : 401)) };
  }

  return {
    admin,
    supabase,
    user: data.user,
    authSessionId: getAuthSessionId(data.session?.access_token),
    email: credentials.email,
    deviceId,
    finish,
  };
}

export async function recordAttempt(
  admin: ReturnType<typeof createAdminClient>, email: string, deviceId: string,
  kind: LoginKind, result: "success" | "failed" | "blocked" | "device_conflict" | "denied" | "logout",
  userId?: string,
) {
  const { data, error } = await admin.rpc("record_login_attempt", {
    p_email: email, p_device_id: deviceId, p_kind: kind, p_result: result, p_user_id: userId ?? null,
  });
  if (error) throw error;
  return data as string | null;
}

export function loginError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}
