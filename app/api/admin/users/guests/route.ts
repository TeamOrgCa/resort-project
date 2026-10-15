import { NextResponse } from "next/server";
import { requireAdminStaff } from "@/lib/server/admin-audit";

export async function GET(request: Request) {
  try {
    const staff = await requireAdminStaff();
    if (!staff) return NextResponse.json({ success: false, message: "Administrator access is required." }, { status: 403 });
    const query = new URL(request.url).searchParams;
    const search = query.get("search") ?? "", status = query.get("status") ?? "all", page = Number(query.get("page") ?? 0);
    if (search.length > 200 || !["all", "active", "inactive"].includes(status) || !Number.isSafeInteger(page) || page < 0 || page > 1000000) {
      return NextResponse.json({ success: false, message: "Invalid guest account filters." }, { status: 400 });
    }
    const { data, error } = await staff.supabase.rpc("admin_guest_accounts", { p_search: search.trim(), p_status: status, p_page: page, p_page_size: 10 });
    if (error) return NextResponse.json({ success: false, message: "Unable to load guest accounts. Check that the guest account status migration is installed." }, { status: error.code === "42501" ? 403 : 503 });
    return NextResponse.json({ success: true, ...data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to load guest accounts." }, { status: 500 });
  }
}
