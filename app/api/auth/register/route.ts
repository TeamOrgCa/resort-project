import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { validateGuestRegistration } from "@/lib/auth/guest-registration";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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

    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
    const { data, error } = await supabase.auth.signUp({
      email: guest.email,
      password: guest.password,
      options: { data: {
        first_name: guest.firstName,
        last_name: guest.lastName,
        middle_name: guest.middleName,
        phone_number: guest.phoneNumber,
        address: guest.address,
      } },
    });
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    if (!data.user) throw new Error("Sign-up returned no user.");

    // Supabase can return an obfuscated user for an existing email. Never write a
    // guest profile for that response; keep the same confirmation message.
    if (data.user.identities?.length === 0) {
      return NextResponse.json({ success: true, needsEmailConfirmation: true });
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

    return NextResponse.json({ success: true, needsEmailConfirmation: !data.session });
  } catch (error) {
    console.error("Guest registration failed:", error);
    return NextResponse.json({ message: "Unable to create your account. Please try again." }, { status: 500 });
  }
}
