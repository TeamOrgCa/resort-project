import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { InvalidDateRangeError, parseCustomDateRange } from "@/lib/server/custom-date-range";
import { auditDateRange, AUDIT_PERIODS, type AuditPeriod } from "@/lib/admin/audit-date-range";
import { auditAction, auditModule, auditSummary, auditTitle, isAuditUuid as isUuid } from "@/lib/admin/audit-presentation";
import { fetchByIds } from "@/lib/server/fetch-all-pages";

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
  email?: string;
}

interface GuestRow {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
}

export async function GET(request: Request) {
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

    const params = new URL(request.url).searchParams;
    const startDate = params.get("startDate"), endDate = params.get("endDate");
    const period = params.get("period");
    let range: ReturnType<typeof parseCustomDateRange> | undefined;
    try {
      if (period !== null) {
        if (!Object.hasOwn(AUDIT_PERIODS, period)) throw new InvalidDateRangeError("Choose a valid audit period.");
        range = auditDateRange(period as AuditPeriod, startDate, endDate);
      } else if (startDate !== null || endDate !== null) range = parseCustomDateRange(startDate, endDate);
    } catch (cause) {
      if (cause instanceof InvalidDateRangeError) return NextResponse.json({ success: false, message: cause.message }, { status: 400 });
      throw cause;
    }

    let query = staffContext.supabase
      .from("audit_logs")
      .select("log_id, user_id, auth_user_id, action, entity_type, entity_id, attempted_email, details, created_at");
    if (range) query = query.gte("created_at", range.start.toISOString()).lt("created_at", range.end.toISOString());
    const { data: logsData, error: logsError } = await query.order("created_at", { ascending: false }).limit(301);

    if (logsError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to load audit logs.",
        },
        { status: 500 }
      );
    }

    const matchingLogs = (logsData as AuditLogRow[] | null) ?? [];
    const logs = matchingLogs.slice(0, 300);
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
        ? lookupClient.from("guests").select("id, first_name, middle_name, last_name").in("id", guestIds)
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
      accumulator[row.id] = [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(" ");
      return accumulator;
    }, {});

    const labels = new Map<string, string>();
    for (const [id, name] of Object.entries(staffById)) labels.set(id, name);
    for (const [id, name] of Object.entries(guestById)) labels.set(id, name);
    const idsFor = (types: string[]) => [...new Set(logs.filter((log) => types.includes(log.entity_type ?? "") && log.entity_id && isUuid(log.entity_id)).map((log) => log.entity_id as string))];
    const detailIds = new Map<string, Set<string>>();
    const collectIds = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === "string" && isUuid(entry)) {
          const field = key.replace(/_/g, "").toLowerCase();
          if (!detailIds.has(field)) detailIds.set(field, new Set());
          detailIds.get(field)!.add(entry);
        } else collectIds(entry);
      }
    };
    logs.forEach(log => collectIds(log.details));
    const detailReservationIds = [...(detailIds.get("reservationid") ?? [])];
    const reservationIds = [...new Set([...idsFor(["reservation", "reservations"]), ...detailReservationIds])];
    const queries = [
      { types: ["reservation"], table: "reservations", id: "reservation_id", select: "reservation_id, reference_number", label: (row: Record<string, unknown>) => `Reservation ${row.reference_number}` },
      { types: ["payment", "payments"], table: "payments", id: "payment_id", select: "payment_id, reference_number, reservation_id", label: (row: Record<string, unknown>) => `Payment ${row.reference_number ?? "(reference unavailable)"}` },
      { types: ["ocular_visit", "ocular_visits"], table: "ocular_visits", id: "visit_id", select: "visit_id, reference_number", label: (row: Record<string, unknown>) => `Ocular visit ${row.reference_number}` },
      { types: ["staff_user"], table: "staff_users", id: "id", select: "id, full_name, email", label: (row: Record<string, unknown>) => `${row.full_name} (${row.email})` },
      { types: ["guest_account"], table: "guests", id: "id", select: "id, first_name, last_name, email", label: (row: Record<string, unknown>) => `${row.first_name} ${row.last_name} (${row.email})` },
      { types: ["refund_request", "refund_requests"], table: "refund_requests", id: "refund_id", select: "refund_id, reservation_id", label: (row: Record<string, unknown>) => `Refund for ${labels.get(String(row.reservation_id)) ?? "booking (reference unavailable)"}` },
      { types: ["reservation_reschedule", "reservation_reschedules"], table: "reservation_reschedules", id: "reschedule_id", select: "reschedule_id, reservation_id", label: (row: Record<string, unknown>) => `Reschedule for ${labels.get(String(row.reservation_id)) ?? "booking (reference unavailable)"}` },
      { types: ["transaction", "transactions"], table: "transactions", id: "transaction_id", select: "transaction_id, reservation_id", label: (row: Record<string, unknown>) => `Bill for ${labels.get(String(row.reservation_id)) ?? "booking (reference unavailable)"}` },
      { types: ["payment_account", "payment_accounts"], table: "payment_accounts", id: "account_id", select: "account_id, account_name", label: (row: Record<string, unknown>) => `Receiving account: ${row.account_name}` },
      { types: ["services"], table: "services", id: "service_id", select: "service_id, name", label: (row: Record<string, unknown>) => String(row.name) },
      { types: ["public_access_sale"], table: "public_access_sales", id: "sale_id", select: "sale_id, reference_number", label: (row: Record<string, unknown>) => `Public access ${row.reference_number}` },
      { types: ["units"], table: "units", id: "unit_id", select: "unit_id, name", label: (row: Record<string, unknown>) => String(row.name) },
      { types: ["payment_methods"], table: "payment_methods", id: "payment_method_id", select: "payment_method_id, name", label: (row: Record<string, unknown>) => String(row.name) },
      { types: ["reservation_policies"], table: "reservation_policies", id: "policy_id", select: "policy_id, title, version", label: (row: Record<string, unknown>) => `${row.title} (version ${row.version})` },
      { types: ["maintenance_block", "maintenance_blocks"], table: "maintenance_blocks", id: "block_id", select: "block_id, name", label: (row: Record<string, unknown>) => `Maintenance: ${row.name}` },
    ];
    const resolvedRows: Array<{ query: (typeof queries)[number]; row: Record<string, unknown> }> = [];
    await Promise.all(queries.slice(1).map(async (query) => {
      const ids = [...new Set([...idsFor(query.types), ...(detailIds.get(query.id.replace(/_/g, "")) ?? [])])];
      if (!ids.length) return;
      const data = await fetchByIds<Record<string, unknown>>(ids, async (batch, from, to) => {
        const result = await lookupClient.from(query.table).select(query.select).in(query.id, batch).range(from, to);
        return { data: result.data as unknown as Record<string, unknown>[] | null, error: result.error };
      }).catch(() => []);
      for (const row of data) {
        resolvedRows.push({ query, row });
        if (typeof row.reservation_id === "string") reservationIds.push(row.reservation_id);
      }
    }));
    const reservationQuery = queries[0];
    if (reservationIds.length) {
      const data = await fetchByIds<Record<string, unknown>>(reservationIds, async (batch, from, to) => {
        const result = await lookupClient.from(reservationQuery.table).select(reservationQuery.select).in(reservationQuery.id, batch).range(from, to);
        return { data: result.data as unknown as Record<string, unknown>[] | null, error: result.error };
      }).catch(() => []);
      for (const row of data) labels.set(String(row.reservation_id), reservationQuery.label(row));
    }
    for (const { query, row } of resolvedRows) labels.set(String(row[query.id]), query.label(row));

    const rows = logs.map((log) => {
      const summary = auditSummary(log.details, labels, log.entity_type);
      const preview = summary.split("\n").slice(0, 2).join(" · ");
      return {
      id: log.log_id,
      staff: log.user_id
        ? staffById[log.user_id] ?? "Staff name unavailable"
        : log.auth_user_id
          ? staffById[log.auth_user_id] ?? guestById[log.auth_user_id] ?? "Account name unavailable"
          : log.attempted_email ?? "System",
      module: auditModule(log.entity_type),
      action: auditAction(log.action),
      record: log.entity_id
        ? log.entity_type === "staff_session" ? "Staff session"
          : log.entity_type === "role_permissions" ? `${log.entity_id === "staff" ? "Manager" : log.entity_id === "all" ? "Manager and cashier" : auditTitle(log.entity_id)} permissions`
          : labels.get(log.entity_id) ?? `${auditTitle(log.entity_type ?? "Record")} (${isUuid(log.entity_id) ? "name or reference unavailable" : log.entity_id})`
        : log.attempted_email ?? "—",
      recordId: log.entity_id ?? "",
      summary,
      summaryPreview: preview.length > 220 ? `${preview.slice(0, 217)}...` : preview,
      originalAction: log.action,
      details: log.details ? JSON.stringify(log.details, null, 2) : "",
      timestamp: log.created_at,
    }; });

    return NextResponse.json({ success: true, rows, hasMore: matchingLogs.length > 300, limit: 300,
      ...(range ? { dateRange: { startDate: range.startDate, endDate: range.endDate } } : {}) }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
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
