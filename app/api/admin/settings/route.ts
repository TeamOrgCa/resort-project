import { NextResponse } from "next/server";
import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { settingDefinitions } from "@/lib/settings/catalog";
import { getAllSettings, updateSettings } from "@/lib/settings/settingsService";
import type { SettingValue, SettingsUpdate } from "@/lib/settings/types";

const isSettingValue = (value: unknown): value is SettingValue =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  typeof value === "boolean" ||
  (Array.isArray(value) && value.every((item) => typeof item === "string")) ||
  (typeof value === "object" && value !== null && !Array.isArray(value));

const settingKeys = new Set(settingDefinitions.map((definition) => definition.key));

const parseUpdates = (value: unknown): SettingsUpdate[] | null => {
  if (!Array.isArray(value)) return null;
  const updates = value as Array<{ key?: unknown; value?: unknown }>;
  if (updates.some((item) => typeof item.key !== "string" || !item.key.trim() || !settingKeys.has(item.key.trim()) || !isSettingValue(item.value))) return null;
  return updates.map((item) => ({ key: String(item.key).trim(), value: item.value as SettingValue }));
};

export async function GET() {
  const staffContext = await requireAdminStaff();
  if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

  try {
    return NextResponse.json({ success: true, settings: await getAllSettings(staffContext.supabase) });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to load settings." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const staffContext = await requireAdminStaff();
  if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

  try {
    const body = (await request.json()) as { updates?: unknown };
    const updates = parseUpdates(body.updates);
    if (!updates || updates.length === 0) {
      return NextResponse.json({ success: false, message: "At least one valid setting is required." }, { status: 400 });
    }

    const settings = await updateSettings(staffContext.supabase, updates);
    await createAuditLog(staffContext, { action: "Updated business settings", entityType: "business_settings" });
    return NextResponse.json({ success: true, settings });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to save settings." }, { status: 500 });
  }
}