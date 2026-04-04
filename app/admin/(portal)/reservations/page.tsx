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
  booking_type: "online" | "walk_in" | null;
}

interface GuestRow {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  address?: string | null;
}

interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  amount: number;
  payment_method: "bank_transfer" | "e_wallet" | "cash";
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

interface TransactionBalanceRow {
  reservation_id: string;
  balance: number | null;
}

interface ReservationUnitDetailRow {
  quantity: number;
  price_per_night: number;
  units: {
    name: string;
    capacity: number;
  } | Array<{
    name: string;
    capacity: number;
  }> | null;
}

interface ReservationServiceDetailRow {
  quantity: number;
  price_at_time: number;
  services: {
    name: string;
  } | Array<{
    name: string;
  }> | null;
}

interface ReservationDetails {
  reservation: ReservationRow;
  guest: GuestRow | null;
  units: Array<{
    name: string;
    quantity: number;
    capacity: number;
    pricePerNight: number;
  }>;
  services: Array<{
    name: string;
    quantity: number;
    priceAtTime: number;
  }>;
}

type ManualPaymentMethod = "bank_transfer" | "e_wallet" | "cash";

interface ManualPaymentForm {
  amount: string;
  paymentReference: string;
  method: ManualPaymentMethod;
  accountName: string;
  accountNumber: string;
  proofFile: File | null;
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

const generatePaymentReference = () =>
  `PMT-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

export default function AdminReservationsPage() {
  const [activeTab, setActiveTab] = useState<(typeof reservationTabs)[number]>("Reservation Records");
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedPaymentRowIds, setSelectedPaymentRowIds] = useState<string[]>([]);
  const [isManualPaymentDialogOpen, setIsManualPaymentDialogOpen] = useState(false);
  const [isCreatingManualPayment, setIsCreatingManualPayment] = useState(false);
  const [manualPaymentError, setManualPaymentError] = useState<string | null>(null);
  const [isReservationDetailsOpen, setIsReservationDetailsOpen] = useState(false);
  const [isReservationDetailsLoading, setIsReservationDetailsLoading] = useState(false);
  const [reservationDetailsError, setReservationDetailsError] = useState<string | null>(null);
  const [reservationDetails, setReservationDetails] = useState<ReservationDetails | null>(null);
  const [reservations, setReservations] = useState<ReservationRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [pendingPaymentApproval, setPendingPaymentApproval] = useState<{ paymentId: string; reference: string } | null>(
    null
  );
  const [isApprovingPayment, setIsApprovingPayment] = useState(false);
  const [manualPaymentForm, setManualPaymentForm] = useState<ManualPaymentForm>({
    amount: "",
    paymentReference: generatePaymentReference(),
    method: "bank_transfer",
    accountName: "",
    accountNumber: "",
    proofFile: null,
  });
  const [ocularVisits, setOcularVisits] = useState<OcularVisitRow[]>([]);
  const [pendingOcularApproval, setPendingOcularApproval] = useState<{ visitId: string; reference: string } | null>(
    null
  );
  const [isApprovingOcularVisit, setIsApprovingOcularVisit] = useState(false);
  const [remainingBalanceByReservationId, setRemainingBalanceByReservationId] = useState<Record<string, number>>({});
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
            "reservation_id, reference_number, guest_id, check_in_date, check_out_date, total_guests, status, created_at, booking_type"
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

        const [
          { data: guestsData, error: guestsError },
          { data: paymentsData, error: paymentsError },
          { data: transactionsData, error: transactionsError },
        ] =
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
                reservationIdList.length
                  ? supabase.from("transactions").select("reservation_id, balance").in("reservation_id", reservationIdList)
                  : Promise.resolve({ data: [], error: null }),
          ]);

        if (guestsError) {
          throw guestsError;
        }

        if (paymentsError) {
          throw paymentsError;
        }

        if (transactionsError) {
          throw transactionsError;
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

        const nextRemainingBalanceByReservationId = (
          (transactionsData as TransactionBalanceRow[] | null) ?? []
        ).reduce<Record<string, number>>((accumulator, transaction) => {
          accumulator[transaction.reservation_id] = Number(transaction.balance ?? 0);
          return accumulator;
        }, {});

        setReservations(reservationList);
        setPayments((paymentsData as PaymentRow[] | null) ?? []);
        setOcularVisits(ocularVisitList);
        setGuestsById(nextGuestsById);
        setReservationReferenceById(nextReservationReferenceById);
        setRemainingBalanceByReservationId(nextRemainingBalanceByReservationId);
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
        method:
          payment.payment_method === "bank_transfer"
            ? "Bank Transfer"
            : payment.payment_method === "e_wallet"
              ? "E-wallet"
              : "Cash",
        type: toTitleCase(payment.payment_type),
        amount: formatCurrency(Number(payment.amount ?? 0)),
        remainingBalance: formatCurrency(Number(remainingBalanceByReservationId[payment.reservation_id] ?? 0)),
        status: toTitleCase(payment.status),
        paidAt: formatDateTime(payment.paid_at),
        proofPath: payment.proof_path,
      })),
    [payments, reservationReferenceById, remainingBalanceByReservationId]
  );

  const selectedPaymentRow = useMemo(() => {
    const selectedId = selectedPaymentRowIds[0];
    if (!selectedId) return null;
    return paymentVerificationRows.find((row) => row.id === selectedId) ?? null;
  }, [paymentVerificationRows, selectedPaymentRowIds]);

  const selectedPaymentReservationId = selectedPaymentRow?.reservationId ?? "";
  const selectedRemainingBalance = Number(remainingBalanceByReservationId[selectedPaymentReservationId] ?? 0);

  const resetManualPaymentForm = () => {
    setManualPaymentForm({
      amount: selectedRemainingBalance > 0 ? selectedRemainingBalance.toFixed(2) : "",
      paymentReference: generatePaymentReference(),
      method: "bank_transfer",
      accountName: "",
      accountNumber: "",
      proofFile: null,
    });
  };

  const handlePaymentAction = (action: string) => {
    if (action !== "Add New Payment Entry") {
      return;
    }

    if (!selectedPaymentRow) {
      setFetchError("Select one payment row first before adding a new payment entry.");
      return;
    }

    if (selectedRemainingBalance <= 0) {
      setFetchError("Selected reservation has no remaining balance.");
      return;
    }

    setFetchError(null);
    setManualPaymentError(null);
    resetManualPaymentForm();
    setIsManualPaymentDialogOpen(true);
  };

  const handleCreateManualPayment = async () => {
    if (!selectedPaymentRow || !selectedPaymentReservationId) {
      setManualPaymentError("Select a reservation payment row first.");
      return;
    }

    const parsedAmount = Number(manualPaymentForm.amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setManualPaymentError("Enter a valid payment amount.");
      return;
    }

    if (parsedAmount > selectedRemainingBalance) {
      setManualPaymentError("Amount cannot exceed remaining balance.");
      return;
    }

    const isCash = manualPaymentForm.method === "cash";

    if (!isCash) {
      if (!manualPaymentForm.accountName.trim() || !manualPaymentForm.accountNumber.trim()) {
        setManualPaymentError("Account details are required for this method.");
        return;
      }

      if (!manualPaymentForm.proofFile) {
        setManualPaymentError("Screenshot of payment is required for this method.");
        return;
      }
    }

    setManualPaymentError(null);
    setIsCreatingManualPayment(true);

    try {
      let proofPath = "";

      if (!isCash && manualPaymentForm.proofFile) {
        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          setManualPaymentError("Unable to resolve current staff session for proof upload.");
          return;
        }

        const safeFileName = manualPaymentForm.proofFile.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
        proofPath = `${user.id}/${Date.now()}-${safeFileName}`;

        const { error: uploadError } = await supabase.storage.from("payment-proofs").upload(proofPath, manualPaymentForm.proofFile, {
          cacheControl: "3600",
          upsert: false,
        });

        if (uploadError) {
          setManualPaymentError(uploadError.message || "Failed to upload payment screenshot.");
          return;
        }
      }

      const response = await fetch("/api/admin/payments/manual-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId: selectedPaymentReservationId,
          amount: parsedAmount,
          paymentMethod: manualPaymentForm.method,
          paymentReference: manualPaymentForm.paymentReference,
          accountName: isCash ? undefined : manualPaymentForm.accountName,
          accountNumber: isCash ? undefined : manualPaymentForm.accountNumber,
          proofPath,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
            payment?: PaymentRow;
            reservationId?: string;
            remainingBalance?: number;
          }
        | null;

      if (!response.ok || !result?.success || !result.payment) {
        setManualPaymentError(result?.message ?? "Failed to create payment entry.");
        return;
      }

      setPayments((currentPayments) => [result.payment as PaymentRow, ...currentPayments]);

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

        setRemainingBalanceByReservationId((currentBalances) => ({
          ...currentBalances,
          [result.reservationId as string]: Number(result.remainingBalance ?? 0),
        }));
      }

      setIsManualPaymentDialogOpen(false);
      setSelectedPaymentRowIds([]);
    } catch {
      setManualPaymentError("Failed to create payment entry.");
    } finally {
      setIsCreatingManualPayment(false);
    }
  };

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

  const handleReservationRowAction = async (action: string, row: AdminTableRow) => {
    if (action !== "View") {
      return;
    }

    const reservationId = typeof row.id === "string" ? row.id : "";

    if (!reservationId) {
      setFetchError("Unable to view reservation details.");
      return;
    }

    setIsReservationDetailsOpen(true);
    setIsReservationDetailsLoading(true);
    setReservationDetailsError(null);
    setReservationDetails(null);

    try {
      const supabase = createClient();

      const { data: reservation, error: reservationError } = await supabase
        .from("reservations")
        .select(
          "reservation_id, reference_number, guest_id, check_in_date, check_out_date, total_guests, status, created_at, booking_type"
        )
        .eq("reservation_id", reservationId)
        .maybeSingle<ReservationRow>();

      if (reservationError || !reservation) {
        setReservationDetailsError("Reservation details were not found.");
        return;
      }

      const [guestResult, unitsResult, servicesResult] = await Promise.all([
        supabase
          .from("guests")
          .select("id, first_name, last_name, middle_name, email, phone_number, address")
          .eq("id", reservation.guest_id)
          .maybeSingle<GuestRow>(),
        supabase
          .from("reservation_units")
          .select("quantity, price_per_night, units(name, capacity)")
          .eq("reservation_id", reservationId),
        supabase
          .from("reservation_services")
          .select("quantity, price_at_time, services(name)")
          .eq("reservation_id", reservationId),
      ]);

      if (guestResult.error || unitsResult.error || servicesResult.error) {
        setReservationDetailsError("Failed to load complete reservation details.");
        return;
      }

      const unitRows = (unitsResult.data as ReservationUnitDetailRow[] | null) ?? [];
      const serviceRows = (servicesResult.data as ReservationServiceDetailRow[] | null) ?? [];

      setReservationDetails({
        reservation,
        guest: guestResult.data,
        units: unitRows.map((unit) => ({
          name: (Array.isArray(unit.units) ? unit.units[0]?.name : unit.units?.name) ?? "Unit",
          quantity: Number(unit.quantity ?? 0),
          capacity: Number((Array.isArray(unit.units) ? unit.units[0]?.capacity : unit.units?.capacity) ?? 0),
          pricePerNight: Number(unit.price_per_night ?? 0),
        })),
        services: serviceRows.map((service) => ({
          name: (Array.isArray(service.services) ? service.services[0]?.name : service.services?.name) ?? "Service",
          quantity: Number(service.quantity ?? 0),
          priceAtTime: Number(service.price_at_time ?? 0),
        })),
      });
    } catch {
      setReservationDetailsError("Failed to load complete reservation details.");
    } finally {
      setIsReservationDetailsLoading(false);
    }
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
        | { message?: string; reservationId?: string; remainingBalance?: number }
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

        setRemainingBalanceByReservationId((currentBalances) => ({
          ...currentBalances,
          [result.reservationId as string]: Number(result.remainingBalance ?? 0),
        }));
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
            onRowAction={handleReservationRowAction}
          />
        )}

        {activeTab === "Payment Verification Queue" && (
          <AdminTablePreview
            title={isLoading ? "Payment Verification Queue (Loading...)" : "Payment Verification Queue"}
            columns={[
              ...paymentVerificationColumns,
              { key: "remainingBalance", label: "Remaining Balance" },
            ]}
            rows={paymentVerificationRows}
            defaultSort={{ key: "paidAt", direction: "desc" }}
            filters={[
              { key: "method", label: "Method", options: paymentMethodOptions },
              { key: "status", label: "Status", options: paymentStatusOptions },
            ]}
            actions={["Export", "Add New Payment Entry"]}
            onAction={handlePaymentAction}
            isActionDisabled={(action) => action === "Add New Payment Entry" && selectedPaymentRowIds.length === 0}
            selectableRows
            singleSelect
            selectedRowIds={selectedPaymentRowIds}
            onSelectedRowIdsChange={setSelectedPaymentRowIds}
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

      {isManualPaymentDialogOpen && selectedPaymentRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-2xl rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-neutral">Add New Payment Entry</h3>
            <p className="mt-1 text-sm text-neutral/70">
              Reservation {selectedPaymentRow.reservationReference} • Remaining balance {formatCurrency(selectedRemainingBalance)}
            </p>

            {manualPaymentError ? (
              <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                {manualPaymentError}
              </p>
            ) : null}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm text-neutral/70">Remaining Balance</label>
                <input
                  value={formatCurrency(selectedRemainingBalance)}
                  readOnly
                  className="w-full rounded-lg border border-neutral/20 bg-base px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-neutral/70">Payment Reference</label>
                <input
                  value={manualPaymentForm.paymentReference}
                  readOnly
                  className="w-full rounded-lg border border-neutral/20 bg-base px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-neutral/70">Amount</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={manualPaymentForm.amount}
                  onChange={(event) =>
                    setManualPaymentForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-neutral/70">Method</label>
                <select
                  value={manualPaymentForm.method}
                  onChange={(event) =>
                    setManualPaymentForm((current) => ({
                      ...current,
                      method: event.target.value as ManualPaymentMethod,
                      accountName: "",
                      accountNumber: "",
                      proofFile: null,
                    }))
                  }
                  className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                >
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="e_wallet">E-wallet</option>
                  <option value="cash">Cash</option>
                </select>
              </div>

              {manualPaymentForm.method !== "cash" ? (
                <>
                  <div>
                    <label className="mb-2 block text-sm text-neutral/70">Account Name</label>
                    <input
                      value={manualPaymentForm.accountName}
                      onChange={(event) =>
                        setManualPaymentForm((current) => ({
                          ...current,
                          accountName: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-neutral/70">
                      {manualPaymentForm.method === "bank_transfer" ? "Reference Number" : "Account Number"}
                    </label>
                    <input
                      value={manualPaymentForm.accountNumber}
                      onChange={(event) =>
                        setManualPaymentForm((current) => ({
                          ...current,
                          accountNumber: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm text-neutral/70">Screenshot of Payment</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(event) =>
                        setManualPaymentForm((current) => ({
                          ...current,
                          proofFile: event.target.files?.[0] ?? null,
                        }))
                      }
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                    />
                    {manualPaymentForm.proofFile ? (
                      <p className="mt-2 text-xs text-neutral/70">Selected: {manualPaymentForm.proofFile.name}</p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={isCreatingManualPayment}
                onClick={() => {
                  if (!isCreatingManualPayment) {
                    setIsManualPaymentDialogOpen(false);
                  }
                }}
                className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isCreatingManualPayment}
                onClick={() => {
                  void handleCreateManualPayment();
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCreatingManualPayment ? "Saving..." : "Save Payment Entry"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isReservationDetailsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/40 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-3xl rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral">Reservation Details</h3>
                <p className="mt-1 text-sm text-neutral/70">Full reservation, guest, units, and services summary.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsReservationDetailsOpen(false);
                }}
                className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
              >
                Close
              </button>
            </div>

            {isReservationDetailsLoading ? <p className="mt-5 text-sm text-neutral/70">Loading reservation details...</p> : null}

            {reservationDetailsError ? (
              <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                {reservationDetailsError}
              </p>
            ) : null}

            {!isReservationDetailsLoading && reservationDetails ? (
              <div className="mt-5 space-y-6">
                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Reservation</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
                    <p>
                      Reference: <span className="font-semibold text-neutral">{reservationDetails.reservation.reference_number}</span>
                    </p>
                    <p>
                      Status: <span className="font-semibold text-neutral">{toTitleCase(reservationDetails.reservation.status)}</span>
                    </p>
                    <p>
                      Check-in: <span className="font-semibold text-neutral">{formatDate(reservationDetails.reservation.check_in_date)}</span>
                    </p>
                    <p>
                      Check-out: <span className="font-semibold text-neutral">{formatDate(reservationDetails.reservation.check_out_date)}</span>
                    </p>
                    <p>
                      Guests: <span className="font-semibold text-neutral">{reservationDetails.reservation.total_guests}</span>
                    </p>
                    <p>
                      Booking Type: <span className="font-semibold text-neutral">{toTitleCase(reservationDetails.reservation.booking_type ?? "online")}</span>
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Guest Info</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
                    <p>
                      Name:{" "}
                      <span className="font-semibold text-neutral">
                        {reservationDetails.guest
                          ? `${reservationDetails.guest.first_name} ${reservationDetails.guest.middle_name ?? ""} ${reservationDetails.guest.last_name}`
                              .replace(/\s+/g, " ")
                              .trim()
                          : "Unknown Guest"}
                      </span>
                    </p>
                    <p>
                      Email: <span className="font-semibold text-neutral">{reservationDetails.guest?.email ?? "-"}</span>
                    </p>
                    <p>
                      Phone: <span className="font-semibold text-neutral">{reservationDetails.guest?.phone_number ?? "-"}</span>
                    </p>
                    <p>
                      Address: <span className="font-semibold text-neutral">{reservationDetails.guest?.address ?? "-"}</span>
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Reserved Units</h4>
                  {reservationDetails.units.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral/70">No units found.</p>
                  ) : (
                    <div className="mt-3 space-y-2 text-sm text-neutral/80">
                      {reservationDetails.units.map((unit, index) => (
                        <p key={`${unit.name}-${index}`}>
                          <span className="font-semibold text-neutral">{unit.name}</span> • Qty {unit.quantity} • Capacity {unit.capacity} • {formatCurrency(unit.pricePerNight)}/night
                        </p>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Services</h4>
                  {reservationDetails.services.length === 0 ? (
                    <p className="mt-3 text-sm text-neutral/70">No add-on services selected.</p>
                  ) : (
                    <div className="mt-3 space-y-2 text-sm text-neutral/80">
                      {reservationDetails.services.map((service, index) => (
                        <p key={`${service.name}-${index}`}>
                          <span className="font-semibold text-neutral">{service.name}</span> • Qty {service.quantity} • {formatCurrency(service.priceAtTime)}
                        </p>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
