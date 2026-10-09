"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import { createClient } from "@/lib/supabase/client";
import { hasPermission } from "@/lib/auth/role-access";
import type { StaffRole } from "@/lib/auth/staff-auth";

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

export default function AdminRecordsPage() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>("Reservation Records");
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

  useEffect(() => {
    let mounted = true;
    const loadRecords = async () => {
      try {
        const supabase = createClient();
        const [{ data: reservationData, error: reservationError }, { data: rescheduleData, error: rescheduleError }, { data: ocularData, error: ocularError }, { data: slotData, error: slotError }] = await Promise.all([
          supabase.from("reservations").select("reservation_id, reference_number, guest_id, start_datetime, end_datetime, adult_count, child_count, status, created_at").order("created_at", { ascending: false }).limit(300),
          supabase.from("reservation_reschedules").select("reschedule_id, reservation_id, requested_by, old_start, old_end, new_start, new_end, reschedule_fee, rate_adjustment, status, created_at").order("created_at", { ascending: false }).limit(300),
          supabase.from("ocular_visits").select("visit_id, reference_number, guest_id, scheduled_date, time_slot_id, status, created_at").order("created_at", { ascending: false }).limit(300),
          supabase.from("ocular_time_slots").select("slot_id, start_time, end_time"),
        ]);
        if (reservationError || rescheduleError || ocularError || slotError) throw reservationError ?? rescheduleError ?? ocularError ?? slotError;
        const reservationRows = (reservationData as Array<Record<string, string | number | null>> | null) ?? [];
        const guestIds = [...new Set([...reservationRows, ...((ocularData as Array<Record<string, string | number | null>> | null) ?? []), ...((rescheduleData as Array<Record<string, string | number | null>> | null) ?? []).map((row) => ({ guest_id: row.requested_by }))].map((row) => String(row.guest_id ?? "")).filter(Boolean))];
        const { data: guestData, error: guestError } = guestIds.length ? await supabase.from("guests").select("id, first_name, last_name").in("id", guestIds) : { data: [], error: null };
        if (guestError) throw guestError;
        if (!mounted) return;
        const guestMap = ((guestData as Guest[] | null) ?? []).reduce<Record<string, Guest>>((map, guest) => ({ ...map, [guest.id]: guest }), {});
        const guestName = (id: string | number | null) => guestMap[String(id ?? "")] ? `${guestMap[String(id)].first_name} ${guestMap[String(id)].last_name}` : "-";
        setReservations(reservationRows.map((row) => ({ id: String(row.reservation_id), reference: String(row.reference_number), guest: guestName(row.guest_id), checkIn: dateTime(String(row.start_datetime)), checkOut: dateTime(String(row.end_datetime)), guests: String(Number(row.adult_count ?? 0) + Number(row.child_count ?? 0)), status: titleCase(String(row.status ?? "")) })));
        const reservationReference = reservationRows.reduce<Record<string, string>>((map, row) => ({ ...map, [String(row.reservation_id)]: String(row.reference_number) }), {});
        setReschedules((((rescheduleData as Array<Record<string, string | number | null>> | null) ?? []).map((row) => ({ id: String(row.reschedule_id), reference: reservationReference[String(row.reservation_id)] ?? "-", guest: guestName(row.requested_by), oldDates: `${dateTime(String(row.old_start))} - ${dateTime(String(row.old_end))}`, newDates: `${dateTime(String(row.new_start))} - ${dateTime(String(row.new_end))}`, additionalCharge: `₱${(Number(row.reschedule_fee ?? 0) + Number(row.rate_adjustment ?? 0)).toFixed(2)}`, status: titleCase(String(row.status ?? "")), requestedAt: dateTime(String(row.created_at)) }))));
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

  const review = async (action: "Approve" | "Reject", row: AdminTableRow) => {
    const isOcular = activeTab === "Ocular Visit Records";
    const rejectionReason = action === "Reject" ? window.prompt("Reason for rejecting this reschedule request:")?.trim() : null;
    if (action === "Reject" && !rejectionReason) return;
    if (action === "Approve" && !window.confirm(`Approve ${isOcular ? "ocular visit" : "reschedule request"} ${row.reference}?${isOcular ? "" : ` Additional charge: ${row.additionalCharge}.`}`)) return;
    setBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      const url = isOcular ? "/api/admin/ocular-visits/approve" : `/api/admin/reschedule-requests/${action === "Approve" ? "approve" : "reject"}`;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(isOcular
        ? { visitId: row.id }
        : { rescheduleId: row.id, ...(rejectionReason ? { rejectionReason } : {}) }) });
      const result = await response.json() as { success?: boolean; message?: string };
      if (!response.ok || !result.success) throw new Error(result.message ?? "Unable to review request.");
      setMessage(result.message ?? "Review saved.");
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to review request.");
    } finally {
      setBusyId(null);
    }
  };

  const activeRows = useMemo(() => activeTab === "Reservation Records" ? reservations : activeTab === "Reschedule Requests" ? reschedules : ocularVisits, [activeTab, ocularVisits, reservations, reschedules]);

  return (
    <div>
      <AdminSectionHeader title="Records" subtitle="A single source of truth for reservations, reschedule requests, and ocular visits." />
      {error ? <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">{error}</p> : null}
      {message ? <p role="status" className="mt-4 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-neutral">{message}</p> : null}
      <section className="mt-6 rounded-2xl border border-neutral/10 bg-white p-4 shadow-sm">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
          {tabs.map((tab) => <button key={tab} type="button" onClick={() => setActiveTab(tab)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === tab ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"}`}>{tab}</button>)}
        </div>
        <AdminTablePreview
          title={isLoading ? `${activeTab} (Loading...)` : activeTab}
          columns={activeTab === "Reservation Records" ? reservationColumns : activeTab === "Reschedule Requests" ? rescheduleColumns : ocularColumns}
          rows={activeRows}
          defaultSort={{ key: activeTab === "Reservation Records" ? "checkIn" : activeTab === "Reschedule Requests" ? "requestedAt" : "scheduledDate", direction: "desc" }}
          filters={[{ key: "status", label: "Status", options: activeTab === "Reschedule Requests" ? ["Pending", "Approved", "Rejected"] : activeTab === "Ocular Visit Records" ? ["Pending", "Confirmed", "Cancelled"] : ["Pending", "Confirmed", "Cancelled", "Completed"] }]}
          rowActions={activeTab === "Reschedule Requests" && canApproveReschedules ? ["Approve", "Reject"] : activeTab === "Ocular Visit Records" && canApproveOcular ? ["Approve"] : []}
          onRowAction={(action, row) => void review(action as "Approve" | "Reject", row)}
          isRowActionDisabled={(_action, row) => Boolean(busyId) || row.status !== "Pending"}
        />
      </section>
    </div>
  );
}
