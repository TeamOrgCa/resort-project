import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";

interface AuditLogRow {
  log_id: string;
  user_id: string | null;
  auth_user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  attempted_email: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface StaffRow {
  id: string;
  full_name: string;
}

interface GuestRow {
  id: string;
  first_name: string;
  last_name: string;
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const title = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const shortId = (value: string) => `#${value.slice(0, 8)}`;

function readableDetails(details: Record<string, unknown> | null, labels: Map<string, string>): string {
  if (!details) return "No additional details recorded.";
  return Object.entries(details).map(([key, value]) => {
    const display = typeof value === "string" && isUuid(value)
      ? labels.get(value) ?? shortId(value)
      : typeof value === "object" && value !== null
        ? JSON.stringify(value, (_key, nested) => typeof nested === "string" && isUuid(nested) ? labels.get(nested) ?? shortId(nested) : nested)
        : String(value);
    return `${title(key)}: ${display}`;
  }).join("\n") || "No additional details recorded.";
}

export async function GET() {
  try {
    const staffContext = await requireActiveStaff();

    if (!staffContext) {
      return NextResponse.json(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 }
      );
    }

    const { data: logsData, error: logsError } = await staffContext.supabase
      .from("audit_logs")
      .select("log_id, user_id, auth_user_id, action, entity_type, entity_id, attempted_email, details, created_at")
      .order("created_at", { ascending: false })
      .limit(300);

    if (logsError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to load audit logs.",
        },
        { status: 500 }
      );
    }

    const logs = (logsData as AuditLogRow[] | null) ?? [];
    const lookupClient = tryCreateAdminClient() ?? staffContext.supabase;
    const staffIds = [...new Set(logs.flatMap((log) => [log.user_id, log.auth_user_id])
      .filter((value): value is string => Boolean(value)))];
    const guestIds = [...new Set(logs.map((log) => log.auth_user_id)
      .filter((value): value is string => Boolean(value)))];

    const [staffResult, guestResult] = await Promise.all([
      staffIds.length
        ? lookupClient.from("staff_users").select("id, full_name, email").in("id", staffIds)
        : Promise.resolve({ data: [], error: null }),
      guestIds.length
        ? lookupClient.from("guests").select("id, first_name, last_name").in("id", guestIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (staffResult.error || guestResult.error) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to load actor details for audit logs.",
        },
        { status: 500 }
      );
    }

    const staffById = ((staffResult.data as StaffRow[] | null) ?? []).reduce<Record<string, string>>((accumulator, row) => {
      accumulator[row.id] = row.full_name;
      return accumulator;
    }, {});
    const guestById = ((guestResult.data as GuestRow[] | null) ?? []).reduce<Record<string, string>>((accumulator, row) => {
      accumulator[row.id] = `${row.first_name} ${row.last_name}`;
      return accumulator;
    }, {});

    const labels = new Map<string, string>();
    for (const [id, name] of Object.entries(staffById)) labels.set(id, name);
    for (const [id, name] of Object.entries(guestById)) labels.set(id, name);
    const idsFor = (types: string[]) => [...new Set(logs.filter((log) => types.includes(log.entity_type ?? "") && log.entity_id && isUuid(log.entity_id)).map((log) => log.entity_id as string))];
    const detailReservationIds = logs.flatMap((log) => {
      const id = log.details?.reservation_id;
      return typeof id === "string" && isUuid(id) ? [id] : [];
    });
    const reservationIds = [...new Set([...idsFor(["reservation"]), ...detailReservationIds])];
    const queries = [
      { types: ["reservation"], table: "reservations", id: "reservation_id", select: "reservation_id, reference_number", label: (row: Record<string, unknown>) => `Reservation ${row.reference_number}` },
      { types: ["payment"], table: "payments", id: "payment_id", select: "payment_id, reference_number", label: (row: Record<string, unknown>) => `Payment ${row.reference_number}` },
      { types: ["ocular_visit"], table: "ocular_visits", id: "visit_id", select: "visit_id, reference_number", label: (row: Record<string, unknown>) => `Ocular visit ${row.reference_number}` },
      { types: ["staff_user"], table: "staff_users", id: "id", select: "id, full_name, email", label: (row: Record<string, unknown>) => `${row.full_name} (${row.email})` },
      { types: ["refund_request"], table: "refund_requests", id: "refund_id", select: "refund_id, reservation_id", label: (row: Record<string, unknown>) => `Refund for ${labels.get(String(row.reservation_id)) ?? `reservation ${shortId(String(row.reservation_id))}`}` },
      { types: ["reservation_reschedule"], table: "reservation_reschedules", id: "reschedule_id", select: "reschedule_id, reservation_id", label: (row: Record<string, unknown>) => `Reschedule for ${labels.get(String(row.reservation_id)) ?? `reservation ${shortId(String(row.reservation_id))}`}` },
      { types: ["transaction"], table: "transactions", id: "transaction_id", select: "transaction_id, reservation_id", label: (row: Record<string, unknown>) => `Transaction for ${labels.get(String(row.reservation_id)) ?? `reservation ${shortId(String(row.reservation_id))}`}` },
      { types: ["payment_account"], table: "payment_accounts", id: "account_id", select: "account_id, account_name", label: (row: Record<string, unknown>) => `Payment account ${row.account_name}` },
    ];
    const resolvedRows: Array<{ query: (typeof queries)[number]; row: Record<string, unknown> }> = [];
    await Promise.all(queries.slice(1).map(async (query) => {
      const ids = idsFor(query.types);
      if (!ids.length) return;
      const { data } = await lookupClient.from(query.table).select(query.select).in(query.id, ids);
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        resolvedRows.push({ query, row });
        if (typeof row.reservation_id === "string") reservationIds.push(row.reservation_id);
      }
    }));
    const reservationQuery = queries[0];
    if (reservationIds.length) {
      const { data } = await lookupClient.from(reservationQuery.table).select(reservationQuery.select).in(reservationQuery.id, [...new Set(reservationIds)]);
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) labels.set(String(row.reservation_id), reservationQuery.label(row));
    }
    for (const { query, row } of resolvedRows) labels.set(String(row[query.id]), query.label(row));

    const rows = logs.map((log) => ({
      id: log.log_id,
      staff: log.user_id
        ? staffById[log.user_id] ?? "Unknown Staff"
        : log.auth_user_id
          ? staffById[log.auth_user_id] ?? guestById[log.auth_user_id] ?? `Account ${shortId(log.auth_user_id)}`
          : log.attempted_email ?? "System",
      module: log.entity_type ? title(log.entity_type) : "General",
      action: log.action,
      record: log.entity_id
        ? log.entity_type === "staff_session" ? "Staff session"
          : log.entity_type === "role_permissions" ? `${log.entity_id === "staff" ? "Manager" : title(log.entity_id)} permissions`
          : labels.get(log.entity_id) ?? `${title(log.entity_type ?? "Record")} ${isUuid(log.entity_id) ? shortId(log.entity_id) : log.entity_id}`
        : log.attempted_email ?? "—",
      recordId: log.entity_id ?? "",
      summary: readableDetails(log.details, labels),
      details: log.details ? JSON.stringify(log.details, null, 2) : "",
      timestamp: log.created_at,
    }));

    return NextResponse.json({ success: true, rows }, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        success: false,
      message: "Unexpected error while loading audit logs.",
      },
      { status: 500 }
    );
  }
}
