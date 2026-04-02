"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import ConfirmationDialog from "@/components/ui/ConfirmationDialog";
import { createClient } from "@/lib/supabase/client";
import {
  manualEntryColumns,
  manualEntryRows,
} from "@/components/admin/content";

const reservationTabs = [
  "Reservation Records",
  "Payment Verification Queue",
  "Manual Booking Entries",
  "Ocular Visit Records",
] as const;

const reservationRecordsColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" },
  { key: "guest", label: "Guest" },
  { key: "checkIn", label: "Check-in" },
  { key: "checkOut", label: "Check-out" },
  { key: "totalGuests", label: "Guests" },
  { key: "status", label: "Status" },
  { key: "createdAt", label: "Created" },
];

const paymentVerificationColumns: AdminTableColumn[] = [
  { key: "reservationReference", label: "Reservation Ref" },
  { key: "paymentReference", label: "Payment Ref" },
  { key: "method", label: "Method" },
  { key: "type", label: "Type" },
  { key: "amount", label: "Amount" },
  { key: "status", label: "Status" },
  { key: "paidAt", label: "Paid At" },
];

interface ReservationRow {
  reservation_id: string;
  reference_number: string;
  guest_id: string;
  check_in_date: string;
  check_out_date: string;
  total_guests: number;
  status: string;
  created_at: string;
}

interface GuestRow {
  id: string;
  first_name: string;
  last_name: string;
}

interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  amount: number;
  payment_method: "bank_transfer" | "e_wallet";
  payment_type: "downpayment" | "full" | "additional";
  status: "pending" | "verified";
  paid_at: string | null;
  reference_number: string;
  proof_path: string;
}

interface OcularVisitRow {
  visit_id: string;
  reference_number: string;
  guest_id: string;
  scheduled_date: string;
  time_slot: string;
  status: "pending" | "confirmed" | "cancelled";
  created_at: string;
}

const formatDate = (value: string | null) => {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatDateTime = (value: string | null) => {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return `${date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

const formatTimeSlotLabel = (slot: string) => {
  const [start, end] = slot.split("-");

  if (!start || !end) {
    return slot;
  }

  const toLabel = (value: string) => {
    const [hourValue, minuteValue] = value.split(":").map((item) => Number(item));

    if (Number.isNaN(hourValue) || Number.isNaN(minuteValue)) {
      return value;
    }

    const meridiem = hourValue >= 12 ? "PM" : "AM";
    const normalizedHour = hourValue % 12 || 12;
    const paddedMinute = minuteValue.toString().padStart(2, "0");

    return `${normalizedHour}:${paddedMinute} ${meridiem}`;
  };

  return `${toLabel(start)} - ${toLabel(end)}`;
};

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export default function AdminReservationsPage() {
  const [activeTab, setActiveTab] = useState<(typeof reservationTabs)[number]>("Reservation Records");
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [pendingPaymentApproval, setPendingPaymentApproval] = useState<{ paymentId: string; reference: string } | null>(
    null
  );
  const [isApprovingPayment, setIsApprovingPayment] = useState(false);
  const [ocularVisits, setOcularVisits] = useState<OcularVisitRow[]>([]);
  const [pendingOcularApproval, setPendingOcularApproval] = useState<{ visitId: string; reference: string } | null>(
    null
  );
  const [isApprovingOcularVisit, setIsApprovingOcularVisit] = useState(false);
  const [guestsById, setGuestsById] = useState<Record<string, GuestRow>>({});
  const [reservationReferenceById, setReservationReferenceById] = useState<Record<string, string>>({});

  useEffect(() => {
    let isMounted = true;

    const fetchData = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);

        const supabase = createClient();

        const { data: reservationsData, error: reservationsError } = await supabase
          .from("reservations")
          .select(
            "reservation_id, reference_number, guest_id, check_in_date, check_out_date, total_guests, status, created_at"
          )
          .order("created_at", { ascending: false })
          .limit(200);

        if (reservationsError) {
          throw reservationsError;
        }

        const reservationList = (reservationsData as ReservationRow[] | null) ?? [];

        const { data: ocularVisitsData, error: ocularVisitsError } = await supabase
          .from("ocular_visits")
          .select("visit_id, reference_number, guest_id, scheduled_date, time_slot, status, created_at")
          .order("created_at", { ascending: false })
          .limit(200);

        if (ocularVisitsError) {
          throw ocularVisitsError;
        }

        const ocularVisitList = (ocularVisitsData as OcularVisitRow[] | null) ?? [];

        const guestIds = [
          ...new Set([...reservationList.map((item) => item.guest_id), ...ocularVisitList.map((item) => item.guest_id)]),
        ].filter(Boolean);
        const reservationIdList = reservationList.map((item) => item.reservation_id);

        const [{ data: guestsData, error: guestsError }, { data: paymentsData, error: paymentsError }] =
          await Promise.all([
            guestIds.length
              ? supabase.from("guests").select("id, first_name, last_name").in("id", guestIds)
              : Promise.resolve({ data: [], error: null }),
            reservationIdList.length
              ? supabase
                  .from("payments")
                  .select(
                    "payment_id, reservation_id, amount, payment_method, payment_type, status, paid_at, reference_number, proof_path"
                  )
                  .in("reservation_id", reservationIdList)
                  .order("paid_at", { ascending: false })
              : Promise.resolve({ data: [], error: null }),
          ]);

        if (guestsError) {
          throw guestsError;
        }

        if (paymentsError) {
          throw paymentsError;
        }

        if (!isMounted) return;

        const nextGuestsById = ((guestsData as GuestRow[] | null) ?? []).reduce<Record<string, GuestRow>>(
          (accumulator, guest) => {
            accumulator[guest.id] = guest;
            return accumulator;
          },
          {}
        );

        const nextReservationReferenceById = reservationList.reduce<Record<string, string>>((accumulator, row) => {
          accumulator[row.reservation_id] = row.reference_number;
          return accumulator;
        }, {});

        setReservations(reservationList);
        setPayments((paymentsData as PaymentRow[] | null) ?? []);
        setOcularVisits(ocularVisitList);
        setGuestsById(nextGuestsById);
        setReservationReferenceById(nextReservationReferenceById);
      } catch {
        if (!isMounted) return;
        setFetchError("Failed to load reservation and payment records.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, []);

  const reservationRecordsRows: AdminTableRow[] = useMemo(
    () =>
      reservations.map((reservation) => {
        const guest = guestsById[reservation.guest_id];
        const guestName = guest
          ? `${guest.first_name} ${guest.last_name}`.replace(/\s+/g, " ").trim()
          : `Guest ${reservation.guest_id.slice(0, 8)}`;

        return {
          id: reservation.reservation_id,
          reference: reservation.reference_number,
          guest: guestName,
          checkIn: formatDate(reservation.check_in_date),
          checkOut: formatDate(reservation.check_out_date),
          totalGuests: String(reservation.total_guests),
          status: toTitleCase(reservation.status),
          createdAt: formatDateTime(reservation.created_at),
        };
      }),
    [guestsById, reservations]
  );

  const paymentVerificationRows: AdminTableRow[] = useMemo(
    () =>
      payments.map((payment) => ({
        id: payment.payment_id,
        reservationId: payment.reservation_id,
        reservationReference: reservationReferenceById[payment.reservation_id] ?? "-",
        paymentReference: payment.reference_number,
        method: payment.payment_method === "bank_transfer" ? "Bank Transfer" : "E-wallet",
        type: toTitleCase(payment.payment_type),
        amount: formatCurrency(Number(payment.amount ?? 0)),
        status: toTitleCase(payment.status),
        paidAt: formatDateTime(payment.paid_at),
        proofPath: payment.proof_path,
      })),
    [payments, reservationReferenceById]
  );

  const handlePaymentRowAction = async (action: string, row: AdminTableRow) => {
    if (action === "Approve") {
      if (row.status === "Verified") {
        return;
      }

      const paymentId = typeof row.id === "string" ? row.id : "";

      if (!paymentId) {
        setFetchError("Unable to approve this payment.");
        return;
      }

      setPendingPaymentApproval({
        paymentId,
        reference: row.paymentReference ?? paymentId,
      });
      return;
    }

    if (action !== "Review") {
      return;
    }

    const proofPath = row.proofPath;

    if (!proofPath) {
      setFetchError("This payment has no uploaded proof file.");
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(proofPath, 120);

    if (error || !data?.signedUrl) {
      setFetchError("Unable to open payment proof image.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const approvePaymentVerification = async (paymentId: string) => {
    setFetchError(null);
    setIsApprovingPayment(true);

    try {
      const response = await fetch("/api/admin/payments/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ paymentId }),
      });

      const result = (await response.json().catch(() => null)) as
        | { message?: string; reservationId?: string }
        | null;

      if (!response.ok) {
        setFetchError(result?.message ?? "Failed to approve payment.");
        return;
      }

      setPayments((currentPayments) =>
        currentPayments.map((payment) =>
          payment.payment_id === paymentId
            ? {
                ...payment,
                status: "verified",
              }
            : payment
        )
      );

      if (result?.reservationId) {
        setReservations((currentReservations) =>
          currentReservations.map((reservation) =>
            reservation.reservation_id === result.reservationId
              ? {
                  ...reservation,
                  status: "confirmed",
                }
              : reservation
          )
        );
      }

      setPendingPaymentApproval(null);
    } catch {
      setFetchError("Failed to approve payment.");
    } finally {
      setIsApprovingPayment(false);
    }
  };

  const ocularVisitRows: AdminTableRow[] = useMemo(
    () =>
      ocularVisits.map((visit) => {
        const guest = guestsById[visit.guest_id];
        const guestName = guest
          ? `${guest.first_name} ${guest.last_name}`.replace(/\s+/g, " ").trim()
          : `Guest ${visit.guest_id.slice(0, 8)}`;

        return {
          id: visit.visit_id,
          reference: visit.reference_number,
          guest: guestName,
          scheduledDate: formatDate(visit.scheduled_date),
          timeSlot: formatTimeSlotLabel(visit.time_slot),
          status: toTitleCase(visit.status),
          createdAt: formatDateTime(visit.created_at),
        };
      }),
    [guestsById, ocularVisits]
  );

  const approveOcularVisit = async (visitId: string) => {
    setFetchError(null);
    setIsApprovingOcularVisit(true);

    try {
      const response = await fetch("/api/admin/ocular-visits/approve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ visitId }),
      });

      const result = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setFetchError(result?.message ?? "Failed to approve ocular visit.");
        return;
      }

      setOcularVisits((currentVisits) =>
        currentVisits.map((visit) =>
          visit.visit_id === visitId
            ? {
                ...visit,
                status: "confirmed",
              }
            : visit
        )
      );

      setPendingOcularApproval(null);
    } catch {
      setFetchError("Failed to approve ocular visit.");
    } finally {
      setIsApprovingOcularVisit(false);
    }
  };

  const handleOcularVisitRowAction = async (action: string, row: AdminTableRow) => {
    if (action !== "Approve") {
      return;
    }

    if (row.status === "Confirmed") {
      return;
    }

    const visitId = typeof row.id === "string" ? row.id : "";

    if (!visitId) {
      setFetchError("Unable to approve this ocular visit.");
      return;
    }

    setPendingOcularApproval({
      visitId,
      reference: row.reference ?? visitId,
    });
  };

  const reservationStatusOptions = useMemo(
    () => [...new Set(reservationRecordsRows.map((row) => row.status))].filter(Boolean),
    [reservationRecordsRows]
  );

  const paymentMethodOptions = useMemo(
    () => [...new Set(paymentVerificationRows.map((row) => row.method))].filter(Boolean),
    [paymentVerificationRows]
  );

  const paymentStatusOptions = useMemo(
    () => [...new Set(paymentVerificationRows.map((row) => row.status))].filter(Boolean),
    [paymentVerificationRows]
  );

  const ocularStatusOptions = useMemo(
    () => [...new Set(ocularVisitRows.map((row) => row.status))].filter(Boolean),
    [ocularVisitRows]
  );

  const ocularTimeSlotOptions = useMemo(
    () => [...new Set(ocularVisitRows.map((row) => row.timeSlot))].filter(Boolean),
    [ocularVisitRows]
  );

  return (
    <div>
      <AdminSectionHeader
        title="Reservation and Booking Management"
        subtitle="Manage website reservations, walk-ins, approvals, and manual entries in one view."
      />

      <section className="mt-6 rounded-2xl border border-neutral/10 bg-white p-4">
        {fetchError ? (
          <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
            {fetchError}
          </p>
        ) : null}

        <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
          {reservationTabs.map((tab) => {
            const isActive = tab === activeTab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {activeTab === "Reservation Records" && (
          <AdminTablePreview
            title={isLoading ? "Reservation Records (Loading...)" : "Reservation Records"}
            columns={reservationRecordsColumns}
            rows={reservationRecordsRows}
            defaultSort={{ key: "createdAt", direction: "desc" }}
            filters={[
              { key: "status", label: "Status", options: reservationStatusOptions },
            ]}
            actions={["Export"]}
            rowActions={["View", "Edit"]}
          />
        )}

        {activeTab === "Payment Verification Queue" && (
          <AdminTablePreview
            title={isLoading ? "Payment Verification Queue (Loading...)" : "Payment Verification Queue"}
            columns={paymentVerificationColumns}
            rows={paymentVerificationRows}
            defaultSort={{ key: "paidAt", direction: "desc" }}
            filters={[
              { key: "method", label: "Method", options: paymentMethodOptions },
              { key: "status", label: "Status", options: paymentStatusOptions },
            ]}
            actions={["Verify Selected"]}
            rowActions={["Review", "Approve"]}
            onRowAction={handlePaymentRowAction}
            isRowActionDisabled={(action, row) =>
              action === "Approve" &&
              (row.status === "Verified" || (isApprovingPayment && pendingPaymentApproval?.paymentId === row.id))
            }
          />
        )}

        {activeTab === "Manual Booking Entries" && (
          <AdminTablePreview
            title="Manual Booking Entries"
            columns={manualEntryColumns}
            rows={manualEntryRows}
            defaultSort={{ key: "reference", direction: "desc" }}
            filters={[
              {
                key: "encodedBy",
                label: "Encoded By",
                options: ["Alex Mendoza", "Bea Navarro", "Carlo Lim"],
              },
            ]}
            actions={["New Entry"]}
            rowActions={["View"]}
          />
        )}

        {activeTab === "Ocular Visit Records" && (
          <AdminTablePreview
            title={isLoading ? "Ocular Visit Records (Loading...)" : "Ocular Visit Records"}
            columns={[
              { key: "reference", label: "Reference" },
              { key: "guest", label: "Guest" },
              { key: "scheduledDate", label: "Scheduled Date" },
              { key: "timeSlot", label: "Time Slot" },
              { key: "status", label: "Status" },
              { key: "createdAt", label: "Created" },
            ]}
            rows={ocularVisitRows}
            defaultSort={{ key: "scheduledDate", direction: "asc" }}
            filters={[
              { key: "status", label: "Status", options: ocularStatusOptions },
              { key: "timeSlot", label: "Time Slot", options: ocularTimeSlotOptions },
            ]}
            actions={["Schedule Visit"]}
            rowActions={["View", "Approve"]}
            onRowAction={handleOcularVisitRowAction}
            isRowActionDisabled={(action, row) =>
              action === "Approve" &&
              (row.status === "Confirmed" || (isApprovingOcularVisit && pendingOcularApproval?.visitId === row.id))
            }
          />
        )}
      </section>

      <ConfirmationDialog
        isOpen={Boolean(pendingOcularApproval)}
        title="Approve Ocular Visit"
        message={`Approve ocular visit ${pendingOcularApproval?.reference ?? ""}?`}
        confirmText="Approve"
        cancelText="Cancel"
        isConfirming={isApprovingOcularVisit}
        onCancel={() => {
          if (!isApprovingOcularVisit) {
            setPendingOcularApproval(null);
          }
        }}
        onConfirm={() => {
          if (pendingOcularApproval) {
            void approveOcularVisit(pendingOcularApproval.visitId);
          }
        }}
      />

      <ConfirmationDialog
        isOpen={Boolean(pendingPaymentApproval)}
        title="Approve Payment"
        message={`Approve payment ${pendingPaymentApproval?.reference ?? ""}? This will verify payment, confirm reservation, and generate invoice/receipt.`}
        confirmText="Approve"
        cancelText="Cancel"
        isConfirming={isApprovingPayment}
        onCancel={() => {
          if (!isApprovingPayment) {
            setPendingPaymentApproval(null);
          }
        }}
        onConfirm={() => {
          if (pendingPaymentApproval) {
            void approvePaymentVerification(pendingPaymentApproval.paymentId);
          }
        }}
      />
    </div>
  );
}
