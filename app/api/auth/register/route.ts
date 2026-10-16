import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { validateGuestRegistration } from "@/lib/auth/guest-registration";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isEmailConfigured } from "@/lib/email";
import { GuestConfirmationError, limitConfirmationRequests, registerGuestWithSmtp, REGISTERED_EMAIL_MESSAGE } from "@/lib/server/guest-confirmation";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ message: "Please submit a valid registration form." }, { status: 400 });
  }

  const validation = validateGuestRegistration(body);
  if (!validation.value) return NextResponse.json({ message: validation.error }, { status: 400 });
  const guest = validation.value;

  try {
    const admin = createAdminClient();
    const { data: { user: currentUser } } = await (await createClient()).auth.getUser();
    if (currentUser) {
      return NextResponse.json({ message: "Sign out of the current account before creating another." }, { status: 409 });
    }

    if (isEmailConfigured()) {
      limitConfirmationRequests(request, guest.email);
      return NextResponse.json(await registerGuestWithSmtp(admin, request, guest));
    }

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error } = await supabase.auth.signUp({
      email: guest.email,
      password: guest.password,
      options: {
        emailRedirectTo: new URL("/auth/confirm", request.url).toString(),
        data: {
          first_name: guest.firstName,
          last_name: guest.lastName,
          middle_name: guest.middleName,
          phone_number: guest.phoneNumber,
          address: guest.address,
        },
      },
    });
    if (error) {
      if (["email_exists", "user_already_exists"].includes(error.code ?? "")) throw new GuestConfirmationError(REGISTERED_EMAIL_MESSAGE, 409, "EMAIL_ALREADY_REGISTERED");
      return NextResponse.json({ message: error.message }, { status: 400 });
    }
    if (!data.user) throw new Error("Sign-up returned no user.");

    // Supabase can return an obfuscated user for an already registered email.
    // Reject it without writing a profile or showing a confirmation success.
    if (data.user.identities?.length === 0) {
      throw new GuestConfirmationError(REGISTERED_EMAIL_MESSAGE, 409, "EMAIL_ALREADY_REGISTERED");
    }

    // A session means Confirm email is disabled in Supabase. Do not leave a
    // newly created, already verified guest account behind in that state.
    if (data.session) {
      const { error: rollbackError } = await admin.auth.admin.deleteUser(data.user.id);
      if (rollbackError) console.error("Unable to roll back unverified guest registration:", rollbackError);
      return NextResponse.json({ message: "Guest email confirmation is unavailable. Please contact the resort." }, { status: 503 });
    }

    // The auth.users trigger creates the profile atomically with the account.
    // Reading it here also avoids changing an existing unconfirmed user's data
    // when Supabase accepts a repeated sign-up request for that email.
    const { data: profile, error: profileError } = await admin.from("guests")
      .select("id").eq("id", data.user.id).maybeSingle();
    if (profileError || !profile) {
      console.error("Guest profile is missing after sign-up:", profileError);
      return NextResponse.json({ message: "Your account needs assistance. Please contact support." }, { status: 500 });
    }

    return NextResponse.json({ success: true, needsEmailConfirmation: true });
  } catch (error) {
    if (!(error instanceof GuestConfirmationError)) console.error("Guest registration failed.");
    return NextResponse.json({ message: error instanceof GuestConfirmationError ? error.message : "Unable to create your account. Please try again.",
      ...(error instanceof GuestConfirmationError && error.code ? { code: error.code } : {}),
    }, { status: error instanceof GuestConfirmationError ? error.status : 500 });
  }
}
