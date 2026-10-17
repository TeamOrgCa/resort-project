import { manilaTimestamp } from "@/lib/booking/manila-date";
import { NextResponse } from "next/server";
import { PERMISSIONS } from "@/lib/auth/role-access";
import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const { data, error } = await staff.supabase.from("role_permissions").select("role, permissions");
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ roles: data });
}

export async function PUT(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ message: "Admin access required." }, { status: 403 });
  const body = await request.json().catch(() => null);
  const updates = body?.roles ?? (body ? [body] : []);
  if (!Array.isArray(updates) || !updates.length || updates.length > 2 || updates.some(item => !item || !["staff", "cashier"].includes(item.role) || !Array.isArray(item.permissions) ||
      item.permissions.some((value: unknown) => typeof value !== "string" || !PERMISSIONS.includes(value as typeof PERMISSIONS[number])) ||
      item.permissions.some((value: string) => ["users", "configuration", "catalog"].includes(value)) ||
      new Set(item.permissions).size !== item.permissions.length) || new Set(updates.map(item => item.role)).size !== updates.length) {
    return NextResponse.json({ message: "Invalid role permissions." }, { status: 400 });
  }
  const { error } = await createAdminClient().from("role_permissions").upsert(updates.map(item => ({
    role: item.role, permissions: item.permissions, updated_at: manilaTimestamp(), updated_by: staff.staffUser.id,
  })));
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  await createAuditLog(staff, { action: "Updated role permissions", entityType: "role_permissions", entityId: updates.length === 1 ? updates[0].role : "all", details: { roles: updates } });
  return NextResponse.json({ success: true });
}
