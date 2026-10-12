import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { publicContentDefaults, publicContentKeys } from "@/lib/settings/public-content";

export async function GET() {
  try {
    // Read only the explicit public allowlist; operational settings stay private.
    const { data, error } = await createAdminClient().from("business_settings")
      .select("setting_key, setting_value").in("setting_key", publicContentKeys);
    if (error) throw error;
    return NextResponse.json({ success: true, settings: { ...publicContentDefaults,
      ...Object.fromEntries((data ?? []).filter((row) => publicContentKeys.includes(row.setting_key)).map((row) => [row.setting_key, row.setting_value])) } },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to load website content." }, { status: 503 });
  }
}
