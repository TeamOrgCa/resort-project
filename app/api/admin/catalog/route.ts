import { NextResponse } from "next/server";
import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/server/fetch-all-pages";
import { catalogResources, isCatalogResource, isCatalogUuid, type CatalogDefinition, type CatalogRecord, type CatalogReferences, type CatalogResource, type CatalogStatus } from "@/lib/catalog/catalog";
import { CatalogValidationError, validateCatalogRecord } from "@/lib/catalog/validation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_QR_BUCKET, PaymentQrStorageError, readCatalogSave, uploadPaymentQr } from "@/lib/catalog/payment-qr";

const invalid = (message: string, status = 400) => NextResponse.json({ success: false, message }, { status });
const failure = (error: unknown) => error instanceof CatalogValidationError ? invalid(error.message) : invalid(error instanceof PaymentQrStorageError ? error.message : "Unable to complete this catalog request. Please try again.", 500);
const databaseFailure = (error: { code?: string; message: string }) => {
  if (error.code === "23505") return invalid("A matching record already exists. Update it instead.", 409);
  if (error.code === "23503") return invalid("The linked record is no longer available. Refresh and try again.", 409);
  if (error.code === "23514") return invalid("These values do not meet the catalog requirements.");
  return invalid("Unable to save this record. Please try again.", 500);
};

function pageNumber(value: string | null, fallback: number, maximum: number): number {
  if (value === null) return fallback;
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(number) || number > maximum) throw new CatalogValidationError("Enter valid pagination values.");
  return number;
}

async function validateReference(client: SupabaseClient, resource: CatalogResource, record: CatalogRecord, existing?: CatalogRecord) {
  const field = resource === "unit_rates" ? "unit_id" : resource === "payment_accounts" ? "payment_method_id" : null;
  if (!field || (existing && existing[field] === record[field])) return;
  const table = field === "unit_id" ? "units" : "payment_methods";
  const { data, error } = await client.from(table).select(field === "unit_id" ? "is_active, archived_at" : "is_active").eq(field, record[field]).maybeSingle<{ is_active: boolean; archived_at?: string | null }>();
  if (error) throw error;
  if (!data || !data.is_active || data.archived_at) throw new CatalogValidationError(`Choose an active ${field === "unit_id" ? "unit" : "payment method"}.`);
}

export async function GET(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return invalid("Unauthorized.", 401);
  try {
    const url = new URL(request.url);
    const client = createAdminClient();
    if (url.searchParams.get("resource") === "references") {
      const [units, paymentMethods] = await Promise.all([
        fetchAllPages<CatalogReferences["units"][number]>((from, to) => client.from("units").select("unit_id, name, is_active, archived_at").order("name").order("unit_id").range(from, to)),
        fetchAllPages<CatalogReferences["paymentMethods"][number]>((from, to) => client.from("payment_methods").select("payment_method_id, name, is_active").order("name").order("payment_method_id").range(from, to)),
      ]);
      return NextResponse.json({ success: true, references: { units, paymentMethods } }, { headers: { "Cache-Control": "no-store" } });
    }
    const resource = url.searchParams.get("resource");
    if (!isCatalogResource(resource)) return invalid("Invalid catalog resource.");
    const definition: CatalogDefinition = catalogResources[resource];
    const status = url.searchParams.get("status") ?? "active";
    if (!["active", "archived", "all"].includes(status)) return invalid("Invalid catalog status.");
    const page = pageNumber(url.searchParams.get("page"), 1, 1000000);
    const pageSize = pageNumber(url.searchParams.get("pageSize"), 25, 100);
    const search = (url.searchParams.get("search") ?? "").trim();
    if (search.length > 200) return invalid("Search must be 200 characters or fewer.");
    const unitId = url.searchParams.get("unitId");
    if (unitId && (resource !== "unit_rates" || !isCatalogUuid(unitId))) return invalid("Select a valid unit filter.");

    const queryForStatus = (filter: CatalogStatus, head = false) => {
      let query = client.from(resource).select(definition.select, { count: "exact", head });
      if (filter === "active") {
        query = query.eq("is_active", true);
        if (resource === "units") query = query.is("archived_at", null);
      } else if (filter === "archived") {
        query = query.or(resource === "units" ? "is_active.eq.false,is_active.is.null,archived_at.not.is.null" : "is_active.eq.false,is_active.is.null");
      }
      if (search && definition.search) query = query.ilike(definition.search, `%${search.replace(/[\\%_]/g, "\\$&")}%`);
      if (unitId) query = query.eq("unit_id", unitId);
      return query;
    };
    const from = (page - 1) * pageSize;
    const [records, active, archived] = await Promise.all([
      queryForStatus(status as CatalogStatus).order(definition.order, { ascending: !definition.order.startsWith("effective_") }).order(definition.id).range(from, from + pageSize - 1),
      queryForStatus("active", true), queryForStatus("archived", true),
    ]);
    if (records.error || active.error || archived.error) return invalid("Unable to load catalog records. Please try again.", 500);
    return NextResponse.json({ success: true, records: records.data ?? [], page, pageSize, total: records.count ?? 0,
      counts: { active: active.count ?? 0, archived: archived.count ?? 0 } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return invalid("Unauthorized.", 401);
  try {
    const { body, file } = await readCatalogSave(request);
    if (!body || !isCatalogResource(body.resource)) return invalid("Invalid catalog resource.");
    const resource = body.resource;
    const definition = catalogResources[resource];
    const record = validateCatalogRecord(resource, body.record);
    const client = createAdminClient();
    await validateReference(client, resource, record);
    if (resource === "payment_accounts" && !file) return invalid("A payment QR image is required. Choose an image before saving.");
    let qrPath: string | null = null;
    if (resource === "payment_accounts" && file) {
      const accountId = crypto.randomUUID();
      qrPath = await uploadPaymentQr(client, accountId, file);
      record.account_id = accountId;
      record.qr_image = qrPath;
    }
    const { data, error } = await client.from(resource).insert({ ...record, is_active: true }).select(definition.select).single<CatalogRecord>();
    if (error) {
      if (qrPath) await client.storage.from(PAYMENT_QR_BUCKET).remove([qrPath]);
      return databaseFailure(error);
    }
    await createAuditLog(staff, { action: `Created ${resource} record`, entityType: resource, entityId: String(data[definition.id]) });
    return NextResponse.json({ success: true, record: data }, { status: 201 });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return invalid("Unauthorized.", 401);
  try {
    const { body, file } = await readCatalogSave(request);
    if (!body || !isCatalogResource(body.resource) || !isCatalogUuid(body.id)) return invalid("Invalid catalog record.");
    const resource = body.resource;
    const definition = catalogResources[resource];
    const client = createAdminClient();
    const existing = await client.from(resource).select(definition.select).eq(definition.id, body.id).maybeSingle<CatalogRecord>();
    if (existing.error) return invalid("Unable to load this record. Please try again.", 500);
    if (!existing.data) return invalid("This catalog record no longer exists.", 404);
    if (resource === "payment_accounts" && !existing.data.qr_image && !file) return invalid("A payment QR image is required. Edit this account and upload its QR before saving or restoring.");

    let update: CatalogRecord;
    if (body.action === "restore" && body.record === undefined) {
      await validateReference(client, resource, existing.data as CatalogRecord);
      update = resource === "units" ? { is_active: true, archived_at: null } : { is_active: true };
    } else if (body.action !== undefined) {
      return invalid("Invalid catalog action.");
    } else {
      update = validateCatalogRecord(resource, body.record, existing.data as CatalogRecord);
      await validateReference(client, resource, update, existing.data as CatalogRecord);
    }
    let qrPath: string | null = null;
    if (resource === "payment_accounts" && file) {
      qrPath = await uploadPaymentQr(client, body.id, file);
      update.qr_image = qrPath;
    }
    const { data, error } = await client.from(resource).update(update).eq(definition.id, body.id).select(definition.select).maybeSingle<CatalogRecord>();
    if (error || !data) {
      if (qrPath) await client.storage.from(PAYMENT_QR_BUCKET).remove([qrPath]);
      return error ? databaseFailure(error) : invalid("This catalog record no longer exists.", 404);
    }
    await createAuditLog(staff, { action: `${body.action === "restore" ? "Restored" : "Updated"} ${resource} record`, entityType: resource, entityId: body.id });
    return NextResponse.json({ success: true, record: data });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return invalid("Unauthorized.", 401);
  try {
    const url = new URL(request.url);
    const resource = url.searchParams.get("resource");
    const id = url.searchParams.get("id");
    if (!isCatalogResource(resource) || !isCatalogUuid(id)) return invalid("Invalid catalog record.");
    const definition = catalogResources[resource];
    const update = resource === "units" ? { is_active: false, archived_at: new Date().toISOString() } : { is_active: false };
    const { data, error } = await createAdminClient().from(resource).update(update).eq(definition.id, id).select(definition.select).maybeSingle<CatalogRecord>();
    if (error) return databaseFailure(error);
    if (!data) return invalid("This catalog record no longer exists.", 404);
    await createAuditLog(staff, { action: `Archived ${resource} record`, entityType: resource, entityId: id });
    return NextResponse.json({ success: true, record: data });
  } catch (error) { return failure(error); }
}
