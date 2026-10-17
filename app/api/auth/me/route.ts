import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { validateGuestProfile } from "@/lib/auth/guest-profile";

export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ success: false, message: "Please sign in to update your profile." }, { status: 401 });
    const validation = validateGuestProfile(await request.json().catch(() => null));
    if (!validation.value) return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
    const { data, error } = await supabase.from("guests").update(validation.value).eq("id", user.id).eq("is_active", true).select("id").maybeSingle();
    if (error) return NextResponse.json({ success: false, message: "Unable to update your profile. Please try again." }, { status: 500 });
    if (!data) return NextResponse.json({ success: false, message: "An active guest profile was not found." }, { status: 404 });
    return NextResponse.json({ success: true, message: "Profile updated." });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to update your profile. Please try again." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in." },
        { status: 401 }
      );
    }

    // Fetch guest profile
    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .select("id, first_name, last_name, email, phone_number, address")
      .eq("id", user.id)
      .single();

    if (guestError || !guest) {
      return NextResponse.json(
        { error: "Guest profile not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ guest }, { status: 200 });
  } catch (error) {
    console.error("Auth ME endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
