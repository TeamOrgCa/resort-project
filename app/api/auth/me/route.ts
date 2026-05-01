import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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
