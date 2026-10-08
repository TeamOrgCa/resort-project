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
  if (!body || !["staff", "cashier"].includes(body.role) || !Array.isArray(body.permissions) ||
      body.permissions.some((value: unknown) => typeof value !== "string" || !PERMISSIONS.includes(value as typeof PERMISSIONS[number])) ||
      body.permissions.some((value: string) => ["users", "configuration", "catalog"].includes(value)) ||
      new Set(body.permissions).size !== body.permissions.length) {
    return NextResponse.json({ message: "Invalid role permissions." }, { status: 400 });
  }
  const { error } = await createAdminClient().from("role_permissions").upsert({
    role: body.role, permissions: body.permissions, updated_at: new Date().toISOString(), updated_by: staff.staffUser.id,
  });
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  await createAuditLog(staff, { action: "Updated role permissions", entityType: "role_permissions", entityId: body.role, details: { permissions: body.permissions } });
  return NextResponse.json({ success: true });
}
