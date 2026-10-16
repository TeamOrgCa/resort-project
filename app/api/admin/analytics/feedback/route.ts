import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseReportPeriod, reportWindow } from "@/lib/reports/periods";
import { InvalidDateRangeError } from "@/lib/server/custom-date-range";
import { REVIEW_IMAGE_BUCKET } from "@/lib/reviews/images";
import type { GuestFeedbackItem } from "@/lib/reviews/feedback";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  try {
    const staff = await requireActiveStaff();
    if (!staff) return json({ message: "Sign in as active resort staff." }, 401);
    if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "analytics")) return json({ message: "Analytics permission required." }, 403);
    const params = new URL(request.url).searchParams, status = params.get("status") ?? "active";
    const page = Number(params.get("page") ?? 0), search = (params.get("search") ?? "").trim();
    if (!["active", "archived", "all"].includes(status) || !Number.isSafeInteger(page) || page < 0 || page > 100000 || search.length > 200) return json({ message: "Invalid feedback filters." }, 400);
    const window = reportWindow(parseReportPeriod(params.get("period")), { startDate: params.get("startDate") ?? "", endDate: params.get("endDate") ?? "" });
    const admin = createAdminClient();
    let query = admin.from("reviews").select("review_id, public_display_name, overall_rating, cleanliness_rating, service_rating, amenities_rating, value_rating, title, review_text, would_recommend, is_approved, created_at, archived_at, archive_reason, image_path", { count: "exact" })
      .gte("created_at", window.start.toISOString()).lt("created_at", window.end.toISOString());
    if (status === "active") query = query.is("archived_at", null);
    if (status === "archived") query = query.not("archived_at", "is", null);
    if (search) query = query.ilike("review_text", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
    const { data, error, count } = await query.order("created_at", { ascending: false }).order("review_id", { ascending: false }).range(page * 10, page * 10 + 9);
    if (error) return json({ message: "Unable to load guest feedback. Check that the feedback management migration is installed." }, 503);
    const rows = (data ?? []) as (Omit<GuestFeedbackItem, "image_url"> & { image_path: string | null })[];
    const paths = rows.flatMap(row => row.image_path ? [row.image_path] : []);
    const urls = new Map<string, string>();
    if (paths.length) {
      try {
        const { data: signed } = await admin.storage.from(REVIEW_IMAGE_BUCKET).createSignedUrls(paths, 600);
        for (const item of signed ?? []) if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl);
      } catch { /* Review text and account actions remain usable if a photo fails. */ }
    }
    return json({ success: true, rows: rows.map(({ image_path, ...row }) => ({ ...row, image_url: image_path ? urls.get(image_path) ?? null : null })),
      total: count ?? 0, page, pageSize: 10, startDate: window.startDate, endDate: window.endDate,
      canArchive: await staffHasPermission(staff.supabase, staff.staffUser.role, "feedback_archive") });
  } catch (error) {
    return json({ message: error instanceof InvalidDateRangeError ? error.message : "Unable to load guest feedback. Please retry." }, error instanceof InvalidDateRangeError ? 400 : 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const staff = await requireActiveStaff();
    if (!staff) return json({ message: "Sign in as active resort staff." }, 401);
    if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "analytics") || !await staffHasPermission(staff.supabase, staff.staffUser.role, "feedback_archive")) return json({ message: "Analytics and feedback archive permissions are required." }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.reviewId !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(body.reviewId)
      || typeof body.archive !== "boolean" || typeof body.reason !== "string" || body.reason.trim().length < 3 || body.reason.length > 500
      || !(body.expectedArchivedAt === null || typeof body.expectedArchivedAt === "string" && Number.isFinite(Date.parse(body.expectedArchivedAt)))) return json({ message: "Choose feedback and enter a reason between 3 and 500 characters." }, 400);
    const { data, error } = await staff.supabase.rpc("set_feedback_archived", { p_review: body.reviewId, p_archive: body.archive, p_reason: body.reason.trim(), p_expected_archived_at: body.expectedArchivedAt });
    if (error) {
      const status = error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "P0002" ? 404 : error.code === "22023" ? 400 : 503;
      return json({ message: status === 503 ? "Unable to update feedback. Check that the feedback management migration is installed." : error.message }, status);
    }
    return json({ success: true, review: data, message: body.archive ? "Feedback archived. It is hidden from public reviews and future analysis." : "Feedback restored." });
  } catch { return json({ message: "Unable to update feedback. Please retry." }, 500); }
}
