"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTabs from "@/components/admin/AdminTabs";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import { createClient } from "@/lib/supabase/client";
import { hasPermission } from "@/lib/auth/role-access";
import type { StaffRole } from "@/lib/auth/staff-auth";
import { useModuleTab } from "@/lib/admin/use-module-tab";
import { fetchAllPages, fetchByIds } from "@/lib/server/fetch-all-pages";
import RecordDialog from "@/components/manage/RecordDialog";
import ReservationRecordDetails from "@/components/admin/ReservationRecordDetails";

const tabs = ["Reservation Records", "Reschedule Requests", "Ocular Visit Records"] as const;
const reservationColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" }, { key: "guest", label: "Guest" },
  { key: "checkIn", label: "Check-in" }, { key: "checkOut", label: "Check-out" },
  { key: "guests", label: "Guests" }, { key: "status", label: "Status" },
];
const rescheduleColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reservation Ref" }, { key: "guest", label: "Guest" },
  { key: "oldDates", label: "Original Schedule" }, { key: "newDates", label: "Requested Schedule" },
  { key: "additionalCharge", label: "Additional Charge" },
  { key: "status", label: "Status" }, { key: "requestedAt", label: "Requested" },
];
const ocularColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" }, { key: "guest", label: "Guest" },
  { key: "scheduledDate", label: "Scheduled Date" }, { key: "timeSlot", label: "Time" }, { key: "status", label: "Status" },
  { key: "createdAt", label: "Created" },
];

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "-";
const dateOnly = (value: string | null) => value ? new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" }) : "-";
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

type Guest = { id: string; first_name: string; last_name: string };
type WalkInGuest = Omit<Guest, "id"> & { walk_in_guest_id: string };
type RecordReview = { action: "Approve" | "Reject"; row: AdminTableRow; isOcular: boolean };

export default function AdminRecordsPage() {
  const [activeTab, setActiveTab] = useModuleTab<(typeof tabs)[number]>("Reservation Records", {
    reschedules: "Reschedule Requests", ocular: "Ocular Visit Records", reservations: "Reservation Records",
  });
  const [reservations, setReservations] = useState<AdminTableRow[]>([]);
  const [reschedules, setReschedules] = useState<AdminTableRow[]>([]);
  const [ocularVisits, setOcularVisits] = useState<AdminTableRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [canApproveReschedules, setCanApproveReschedules] = useState(false);
  const [canApproveOcular, setCanApproveOcular] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<AdminTableRow | null>(null);
  const [selectedReview, setSelectedReview] = useState<RecordReview | null>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [reviewError, setReviewError] = useState<string | null>(null);
  const submittingReview = useRef(false);

  useEffect(() => {
    let mounted = true;
    const loadRecords = async () => {
      try {
        const supabase = createClient();
        const [{ data: reservationData, error: reservationError }, { data: rescheduleData, error: rescheduleError }, { data: ocularData, error: ocularError }, { data: slotData, error: slotError }] = await Promise.all([
          fetchAllPages((from, to) => supabase.from("reservations").select("reservation_id, reference_number, guest_id, walk_in_guest_id, start_datetime, end_datetime, adult_count, child_count, status, created_at").order("created_at", { ascending: false }).order("reservation_id").range(from, to)).then(data => ({ data, error: null })),
          fetchAllPages((from, to) => supabase.from("reservation_reschedules").select("reschedule_id, reservation_id, requested_by, old_start, old_end, new_start, new_end, reschedule_fee, rate_adjustment, status, created_at").order("created_at", { ascending: false }).order("reschedule_id").range(from, to)).then(data => ({ data, error: null })),
          fetchAllPages((from, to) => supabase.from("ocular_visits").select("visit_id, reference_number, guest_id, scheduled_date, time_slot_id, status, created_at").order("created_at", { ascending: false }).order("visit_id").range(from, to)).then(data => ({ data, error: null })),
          supabase.from("ocular_time_slots").select("slot_id, start_time, end_time"),
        ]);
        if (reservationError || rescheduleError || ocularError || slotError) throw reservationError ?? rescheduleError ?? ocularError ?? slotError;
        const reservationRows = (reservationData as Array<Record<string, string | number | null>> | null) ?? [];
        const guestIds = [...new Set([...reservationRows, ...((ocularData as Array<Record<string, string | number | null>> | null) ?? []), ...((rescheduleData as Array<Record<string, string | number | null>> | null) ?? []).map((row) => ({ guest_id: row.requested_by }))].map((row) => String(row.guest_id ?? "")).filter(Boolean))];
        const walkInIds = reservationRows.map(row => String(row.walk_in_guest_id ?? "")).filter(Boolean);
        const [guestData, walkInData] = await Promise.all([
          fetchByIds<Guest>(guestIds, (ids, from, to) => supabase.from("guests")
            .select("id, first_name, last_name").in("id", ids).order("id").range(from, to)),
          fetchByIds<WalkInGuest>(walkInIds, (ids, from, to) => supabase.from("walk_in_guests")
            .select("walk_in_guest_id, first_name, last_name").in("walk_in_guest_id", ids).order("walk_in_guest_id").range(from, to)),
        ]);
        if (!mounted) return;
        const guestMap = ((guestData as Guest[] | null) ?? []).reduce<Record<string, Guest>>((map, guest) => ({ ...map, [guest.id]: guest }), {});
        const walkInMap = Object.fromEntries(walkInData.map(guest => [guest.walk_in_guest_id, guest]));
        const reservationMap = Object.fromEntries(reservationRows.map(row => [String(row.reservation_id), row]));
        const reservationGuestName = (row: (typeof reservationRows)[number]) => {
          const profile = guestMap[String(row.guest_id ?? "")] ?? walkInMap[String(row.walk_in_guest_id ?? "")];
          return profile ? `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim() || "Guest profile unavailable" : "Guest profile unavailable";
        };
        const guestName = (id: string | number | null) => guestMap[String(id ?? "")] ? `${guestMap[String(id)].first_name} ${guestMap[String(id)].last_name}` : "-";
        setReservations(reservationRows.map((row) => ({ id: String(row.reservation_id), reference: String(row.reference_number), guest: reservationGuestName(row), checkIn: dateTime(String(row.start_datetime)), checkOut: dateTime(String(row.end_datetime)), guests: String(Number(row.adult_count ?? 0) + Number(row.child_count ?? 0)), status: titleCase(String(row.status ?? "")) })));
        const reservationReference = reservationRows.reduce<Record<string, string>>((map, row) => ({ ...map, [String(row.reservation_id)]: String(row.reference_number) }), {});
        setReschedules((((rescheduleData as Array<Record<string, string | number | null>> | null) ?? []).map((row) => ({ id: String(row.reschedule_id), reference: reservationReference[String(row.reservation_id)] ?? "-", guest: reservationMap[String(row.reservation_id)] ? reservationGuestName(reservationMap[String(row.reservation_id)]) : guestName(row.requested_by), oldDates: `${dateTime(String(row.old_start))} - ${dateTime(String(row.old_end))}`, newDates: `${dateTime(String(row.new_start))} - ${dateTime(String(row.new_end))}`, additionalCharge: `₱${(Number(row.reschedule_fee ?? 0) + Number(row.rate_adjustment ?? 0)).toFixed(2)}`, status: titleCase(String(row.status ?? "")), requestedAt: dateTime(String(row.created_at)) }))));
        const slots = Object.fromEntries(((slotData as Array<{ slot_id: string; start_time: string; end_time: string }> | null) ?? []).map((slot) => [slot.slot_id, `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`]));
        setOcularVisits((((ocularData as Array<Record<string, string | number | null>> | null) ?? []).map((row) => ({ id: String(row.visit_id), reference: String(row.reference_number), guest: guestName(row.guest_id), scheduledDate: dateOnly(String(row.scheduled_date)), timeSlot: slots[String(row.time_slot_id)] ?? "-", status: titleCase(String(row.status ?? "")), createdAt: dateTime(String(row.created_at)) }))));
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { data: staff } = await supabase.from("staff_users").select("role").eq("id", user.id).maybeSingle<{ role: StaffRole }>();
          if (staff) {
            const { data: grants } = staff.role === "admin" ? { data: null } : await supabase.from("role_permissions").select("permissions").eq("role", staff.role).maybeSingle();
            if (mounted) {
              setCanApproveReschedules(hasPermission(staff.role, grants?.permissions ?? [], "reschedule_approval"));
              setCanApproveOcular(hasPermission(staff.role, grants?.permissions ?? [], "ocular_approval"));
            }
          }
        }
      } catch {
        if (mounted) setError("Failed to load records.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    void loadRecords();
    return () => { mounted = false; };
  }, [refreshKey]);

  const openReview = (action: "Approve" | "Reject", row: AdminTableRow) => {
    setSelectedReview({ action, row, isOcular: activeTab === "Ocular Visit Records" });
    setReviewReason("");
    setReviewError(null);
  };
  const closeReview = () => { if (!submittingReview.current) setSelectedReview(null); };
  const needsReason = selectedReview?.isOcular || selectedReview?.action === "Reject";
  const validReason = !needsReason || (reviewReason.trim().length >= (selectedReview?.isOcular ? 5 : 1) && reviewReason.trim().length <= 2000);

  const review = async () => {
    if (!selectedReview || submittingReview.current || !validReason) return;
    const { action, row, isOcular } = selectedReview;
    const rejectionReason = needsReason ? reviewReason.trim() : null;
    submittingReview.current = true;
    setBusyId(row.id);
    setReviewError(null);
    setError(null);
    setMessage(null);
    try {
      const url = isOcular ? `/api/admin/ocular-visits/${action === "Approve" ? "approve" : "reject"}` : `/api/admin/reschedule-requests/${action === "Approve" ? "approve" : "reject"}`;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isOcular
        ? { visitId: row.id, reviewReason: rejectionReason }
        : { rescheduleId: row.id, ...(rejectionReason ? { rejectionReason } : {}) }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "Unable to review request.");
      setMessage(result.message ?? "Review saved.");
      setSelectedReview(null);
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setReviewError(cause instanceof Error ? cause.message : "Unable to review request.");
    } finally {
      submittingReview.current = false;
      setBusyId(null);
    }
  };

  const activeRows = useMemo(() => activeTab === "Reservation Records" ? reservations : activeTab === "Reschedule Requests" ? reschedules : ocularVisits, [activeTab, ocularVisits, reservations, reschedules]);

  return (
    <div>
      <AdminSectionHeader title="Records" subtitle="A single source of truth for reservations, reschedule requests, and ocular visits." />
      {error ? <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-xl border border-green-300 bg-green-50 px-3 py-2 text-sm text-neutral">{message}</p> : null}
      <section className="admin-panel mt-6">
        <AdminTabs tabs={tabs} value={activeTab} onChange={setActiveTab} label="Record sections" />
        <AdminTablePreview
          title={isLoading ? `${activeTab} (Loading...)` : activeTab}
          columns={activeTab === "Reservation Records" ? reservationColumns : activeTab === "Reschedule Requests" ? rescheduleColumns : ocularColumns}
          rows={activeRows}
          pageSize={25}
          showResetFilters
          defaultSort={{ key: activeTab === "Reservation Records" ? "checkIn" : activeTab === "Reschedule Requests" ? "requestedAt" : "scheduledDate", direction: "desc" }}
          filters={[{ key: "status", label: "Status", options: activeTab === "Reschedule Requests" ? ["Pending", "Approved", "Rejected"] : activeTab === "Ocular Visit Records" ? ["Pending", "Confirmed", "Rejected", "Cancelled"] : ["Pending", "Confirmed", "Cancelled", "Completed"] }]}
          rowActions={activeTab === "Reservation Records" ? ["View"] : activeTab === "Reschedule Requests" && canApproveReschedules ? ["Approve", "Reject"] : activeTab === "Ocular Visit Records" && canApproveOcular ? ["Approve", "Reject"] : []}
          onRowAction={(action, row) => { if (action === "View") setSelectedReservation(row); else openReview(action as "Approve" | "Reject", row); }}
          isRowActionDisabled={(action, row) => action === "View" ? false : Boolean(busyId) || row.status !== "Pending"}
        />
      </section>
      {selectedReview && <RecordDialog variant="admin" title={`${selectedReview.action} ${selectedReview.isOcular ? "ocular visit" : "reschedule request"}`} reference={selectedReview.row.reference} busy={Boolean(busyId)} onClose={closeReview}>
        <form className="space-y-5" onSubmit={event => { event.preventDefault(); void review(); }}>
          <dl className="grid gap-3 rounded-xl border border-neutral/10 bg-base p-4 text-sm sm:grid-cols-2">
            {[
              ["Guest", selectedReview.row.guest],
              ...(selectedReview.isOcular
                ? [["Scheduled date", selectedReview.row.scheduledDate], ["Time", selectedReview.row.timeSlot]]
                : [["Original schedule", selectedReview.row.oldDates], ["Requested schedule", selectedReview.row.newDates], ["Additional charge", selectedReview.row.additionalCharge]]),
            ].map(([label, value]) => <div key={label}><dt className="text-neutral/60">{label}</dt><dd className="mt-1 font-medium text-neutral">{value}</dd></div>)}
          </dl>
          <p className="text-sm text-neutral/75">{selectedReview.action === "Approve"
            ? `Confirm approval of this ${selectedReview.isOcular ? "ocular visit" : "reschedule request"}.`
            : `Confirm rejection of this ${selectedReview.isOcular ? "ocular visit" : "reschedule request"}. The reason will be shared with the guest.`}</p>
          {needsReason && <label className="block text-sm font-medium text-neutral">
            {selectedReview.isOcular ? "Review reason" : "Rejection reason"} <span className="text-red-700">(required)</span>
            <textarea name="reviewReason" required minLength={selectedReview.isOcular ? 5 : 1} maxLength={2000} rows={4} value={reviewReason} onChange={event => setReviewReason(event.target.value)} aria-describedby="record-review-reason-help" className="admin-field mt-2 w-full" placeholder={`Explain why this ${selectedReview.isOcular ? "ocular visit" : "reschedule request"} should be ${selectedReview.action === "Approve" ? "approved" : "rejected"}.`} />
            <span id="record-review-reason-help" className="mt-1 block text-xs font-normal text-neutral/60">{selectedReview.isOcular ? "Enter 5 to 2,000 characters. " : "Enter up to 2,000 characters. "}This reason will be shared with the guest.</span>
          </label>}
          {reviewError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{reviewError}</p>}
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={closeReview} disabled={Boolean(busyId)} className="admin-button-secondary">Cancel</button>
            <button type="submit" disabled={Boolean(busyId) || !validReason} className={selectedReview.action === "Approve" ? "admin-button-primary" : "admin-button-secondary border-red-200 text-red-700 hover:bg-red-50"}>{busyId ? "Saving..." : selectedReview.action === "Approve" ? "Confirm approval" : "Confirm rejection"}</button>
          </div>
        </form>
      </RecordDialog>}
      {selectedReservation && <RecordDialog variant="admin" title="Reservation record" reference={selectedReservation.reference} busy={false} onClose={() => setSelectedReservation(null)}>
        <ReservationRecordDetails key={selectedReservation.id} reservationId={selectedReservation.id} />
      </RecordDialog>}
    </div>
  );
}
