import { NextResponse } from "next/server";
import { requireAdminStaff, createAuditLog } from "@/lib/server/admin-audit";
import { contentDefinitions } from "@/lib/settings/content-catalog";
import { updateSettings } from "@/lib/settings/settingsService";

export async function POST() {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Administrator access is required." }, { status: 401 });
  try {
    const settings = await updateSettings(staff.supabase, contentDefinitions.map(definition => ({ key: definition.key, value: definition.defaultValue })));
    try {
      await createAuditLog(staff, { action: "Restored default website content", entityType: "business_settings", details: { keys: contentDefinitions.map(definition => definition.key) } });
    } catch (error) { console.error("Website defaults restored but audit logging failed:", error); }
    return NextResponse.json({ success: true, settings }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to restore website defaults. Please retry." }, { status: 500 });
  }
}
