import { NextResponse } from "next/server";
import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";

const resources = {
  services: { table: "services", select: "service_id, name, description, price, is_active, created_at", id: "service_id" },
  units: { table: "units", select: "unit_id, unit_img, name, description, capacity, base_price, is_active, archived_at", id: "unit_id" },
  unit_rates: { table: "unit_rates", select: "unit_rate_id, unit_id, price, effective_from, effective_to, is_active, created_at", id: "unit_rate_id" },
  guest_rates: { table: "guest_rates", select: "rate_id, adult_rate, child_rate, effective_from, effective_to, is_active, created_at", id: "rate_id" },
  payment_methods: { table: "payment_methods", select: "payment_method_id, name, type, is_active, created_at", id: "payment_method_id" },
  payment_accounts: { table: "payment_accounts", select: "account_id, payment_method_id, account_name, account_number, qr_image, instructions, is_active, created_at", id: "account_id" },
  reservation_policies: { table: "reservation_policies", select: "policy_id, title, content, display_order, is_active, updated_at", id: "policy_id" },
  ocular_time_slots: { table: "ocular_time_slots", select: "slot_id, start_time, end_time, max_capacity, is_active", id: "slot_id" },
} as const;

type Resource = keyof typeof resources;

const getResource = (value: string | null): (typeof resources)[Resource] | null => {
  if (!value || !(value in resources)) return null;
  return resources[value as Resource];
};

export async function GET(request: Request) {
  const staffContext = await requireAdminStaff();
  if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const resource = getResource(url.searchParams.get("resource"));
  if (!resource) return NextResponse.json({ success: false, message: "Invalid catalog resource." }, { status: 400 });

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 25)));
  const from = (page - 1) * pageSize;
  const tableName: string = resource.table;
  const columns: string = resource.select;
  const { data, error, count } = await createAdminClient().from(tableName).select(columns, { count: "exact" }).range(from, from + pageSize - 1);
  if (error) return NextResponse.json({ success: false, message: "Unable to load catalog records." }, { status: 500 });
  return NextResponse.json({ success: true, records: data ?? [], page, pageSize, total: count ?? 0 });
}

export async function POST(request: Request) {
  const staffContext = await requireAdminStaff();
  if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  const body = (await request.json()) as { resource?: string; record?: Record<string, unknown> };
  const resource = getResource(body.resource ?? null);
  if (!resource || !body.record || typeof body.record !== "object") return NextResponse.json({ success: false, message: "Invalid catalog record." }, { status: 400 });
  const tableName: string = resource.table;
  const columns: string = resource.select;
  const { data, error } = await createAdminClient().from(tableName).insert(body.record).select(columns).single();
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
  await createAuditLog(staffContext, { action: `Created ${resource.table} record`, entityType: resource.table });
  return NextResponse.json({ success: true, record: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const staffContext = await requireAdminStaff();
  if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  const body = (await request.json()) as { resource?: string; id?: string; record?: Record<string, unknown> };
  const resource = getResource(body.resource ?? null);
  if (!resource || !body.id || !body.record || typeof body.record !== "object") return NextResponse.json({ success: false, message: "Invalid catalog update." }, { status: 400 });
  const tableName: string = resource.table;
  const columns: string = resource.select;
  const idColumn: string = resource.id;
  const { data, error } = await createAdminClient().from(tableName).update(body.record).eq(idColumn, body.id).select(columns).single();
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
  await createAuditLog(staffContext, { action: `Updated ${resource.table} record`, entityType: resource.table, entityId: body.id });
  return NextResponse.json({ success: true, record: data });
}

export async function DELETE(request: Request) {
  const staffContext = await requireAdminStaff();
  if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  const url = new URL(request.url);
  const resourceKey = url.searchParams.get("resource") as Resource;
  const resource = getResource(resourceKey);
  const id = url.searchParams.get("id");
  if (!resource || !id) return NextResponse.json({ success: false, message: "Invalid catalog record." }, { status: 400 });
  const tableName: string = resource.table;
  const idColumn: string = resource.id;
  const archive = resourceKey === "units" ? { is_active: false, archived_at: new Date().toISOString() } : { is_active: false };
  const { error } = await createAdminClient().from(tableName).update(archive).eq(idColumn, id);
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 400 });
  await createAuditLog(staffContext, { action: `Archived ${resource.table} record`, entityType: resource.table, entityId: id });
  return NextResponse.json({ success: true });
}