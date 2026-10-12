import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { isEmailConfigured } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/admin";
import { GuestConfirmationError, limitConfirmationRequests, sendGuestConfirmation } from "@/lib/server/guest-confirmation";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ message: "Enter a valid email address." }, { status: 400 });
  }
  try {
    if (isEmailConfigured()) {
      limitConfirmationRequests(request, email);
      const delivered = await sendGuestConfirmation(createAdminClient(), request, email);
      if (delivered === false) throw new GuestConfirmationError("Unable to send confirmation email. Please try again later.");
      return NextResponse.json({ success: true, message: "If this address has an unconfirmed account, a new confirmation email is on its way." });
    }
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: new URL("/auth/confirm", request.url).toString() },
    });
    if (error) {
      return NextResponse.json({
        message: error.status === 429 ? "Please wait before requesting another confirmation email." : "Unable to resend confirmation email. Please try again later.",
      }, { status: error.status === 429 ? 429 : 502 });
    }
    return NextResponse.json({ success: true, message: "If this address has an unconfirmed account, a new confirmation email is on its way." });
  } catch (error) {
    return NextResponse.json({ message: error instanceof GuestConfirmationError ? error.message : "Unable to resend confirmation email. Please try again later." }, { status: error instanceof GuestConfirmationError ? error.status : 502 });
  }
}
