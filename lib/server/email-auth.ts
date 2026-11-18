import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { EMAIL_OTP_EXPIRY_SECONDS } from "@/lib/auth/email-expiry";

export const STAFF_OTP_COOKIE = "marville_staff_otp";
export const staffOtpCookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const,
  path: "/api/admin/auth", maxAge: EMAIL_OTP_EXPIRY_SECONDS,
};

function signature(value: string) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Email authentication is unavailable.");
  return createHmac("sha256", secret).update(`marville-email-auth:${value}`).digest("base64url");
}
function matches(actual: string, expected: string) {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Password verification creates a server-signed, browser-bound five-minute OTP window. */
export function createStaffOtpChallenge(email: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ email, issuedAt: now, nonce: randomUUID() })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}
export function validateStaffOtpChallenge(value: string | undefined, email: string, now = Date.now()) {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  try {
    if (!matches(parts[1], signature(parts[0]))) return false;
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload.email === email && typeof payload.issuedAt === "number" &&
      now >= payload.issuedAt && now - payload.issuedAt < EMAIL_OTP_EXPIRY_SECONDS * 1000;
  } catch { return false; }
}

export function passwordResetUrl(request: Request, tokenHash: string, staff: boolean, now = Date.now()) {
  const url = new URL(staff ? "/auth/confirm/staff" : "/auth/confirm", process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin);
  const expires = String(now + EMAIL_OTP_EXPIRY_SECONDS * 1000);
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "recovery");
  url.searchParams.set("expires", expires);
  url.searchParams.set("signature", signature(`${tokenHash}:${expires}:${staff}`));
  return url.toString();
}
export function validPasswordResetExpiry(url: URL, staff: boolean, now = Date.now()) {
  // Supabase-delivered and previously issued links use its provider-side expiry.
  if (!url.searchParams.has("expires") && !url.searchParams.has("signature")) return true;
  const expires = url.searchParams.get("expires") ?? "", mac = url.searchParams.get("signature") ?? "";
  const expiry = Number(expires);
  try {
    return Number.isSafeInteger(expiry) && expiry > now && expiry <= now + EMAIL_OTP_EXPIRY_SECONDS * 1000 &&
      matches(mac, signature(`${url.searchParams.get("token_hash")}:${expires}:${staff}`));
  } catch { return false; }
}

/** Provider timestamps also enforce expiry if someone removes URL parameters. */
export function isRecentRecovery(user: { recovery_sent_at?: string } | null, now = Date.now()) {
  const sent = Date.parse(user?.recovery_sent_at ?? "");
  return Number.isFinite(sent) && now >= sent && now - sent < EMAIL_OTP_EXPIRY_SECONDS * 1000;
}
