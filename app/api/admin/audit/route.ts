import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";

interface AuditLogRow {
  log_id: string;
  user_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  attempted_email: string | null;
  created_at: string;
}

interface StaffRow {
  id: string;
  full_name: string;
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
      .select("log_id, user_id, action, entity_type, entity_id, attempted_email, created_at")
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
    const staffIds = [...new Set(logs.map((log) => log.user_id).filter((value): value is string => Boolean(value)))];

    const { data: staffData, error: staffError } = staffIds.length
      ? await staffContext.supabase.from("staff_users").select("id, full_name").in("id", staffIds)
      : { data: [], error: null };

    if (staffError) {
      return NextResponse.json(
        {
          success: false,
          message: "Failed to load staff details for audit logs.",
        },
        { status: 500 }
      );
    }

    const staffById = ((staffData as StaffRow[] | null) ?? []).reduce<Record<string, string>>((accumulator, row) => {
      accumulator[row.id] = row.full_name;
      return accumulator;
    }, {});

    const rows = logs.map((log) => ({
      id: log.log_id,
      staff: log.user_id ? staffById[log.user_id] ?? "Unknown Staff" : log.attempted_email ?? "System",
      module: log.entity_type ? log.entity_type.replace(/_/g, " ") : "General",
      action: log.action,
      record: log.entity_id ?? log.attempted_email ?? "-",
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
