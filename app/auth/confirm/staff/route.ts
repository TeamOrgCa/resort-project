import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRecentRecovery, validPasswordResetExpiry } from "@/lib/server/email-auth";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("code");
  const destination = new URL("/auth/reset?staff=1", request.url);
  const supabase = await createClient();

  if (validPasswordResetExpiry(request.nextUrl, true)) {
    const result = tokenHash && type === "recovery"
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
      : code ? await supabase.auth.exchangeCodeForSession(code) : null;
    if (result && !result.error) {
      if (isRecentRecovery(result.data.user)) return NextResponse.redirect(destination);
      await supabase.auth.signOut({ scope: "local" });
    }
  }

  destination.pathname = "/auth/reset";
  destination.search = "?error=invalid_link&staff=1";
  return NextResponse.redirect(destination);
}
