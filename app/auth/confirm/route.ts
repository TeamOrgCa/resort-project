import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isRecentRecovery, validPasswordResetExpiry } from "@/lib/server/email-auth";

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("code");
  if (tokenHash && type === "email") {
    // Verify without persisting a session. Guests sign in normally after
    // confirmation so the one-device session record is created on login.
    const confirmationClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await confirmationClient.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("confirmation", error ? "invalid" : "success");
    return NextResponse.redirect(loginUrl);
  }
  if (!tokenHash && !code && type !== "recovery") {
    // The default Supabase signup template redirects with a URL fragment.
    // Fragments are only visible to the browser, so finish that flow there.
    return NextResponse.redirect(new URL("/auth/confirm/complete", request.url));
  }
  const destination = new URL("/auth/reset", request.url);
  if (request.nextUrl.searchParams.get("staff") === "1") {
    destination.searchParams.set("staff", "1");
  }
  const supabase = await createClient();

  if (validPasswordResetExpiry(request.nextUrl, request.nextUrl.searchParams.get("staff") === "1")) {
    const result = tokenHash && type === "recovery"
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" })
      : code ? await supabase.auth.exchangeCodeForSession(code) : null;
    if (result && !result.error) {
      if (isRecentRecovery(result.data.user)) return NextResponse.redirect(destination);
      await supabase.auth.signOut({ scope: "local" });
    }
  }

  destination.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(destination);
}
