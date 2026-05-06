"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";
import ConfirmationDialog from "@/components/ui/ConfirmationDialog";
import { createClient } from "@/lib/supabase/client";
import {
  buildBookingWindow,
  toIsoLocalDay,
  validateBookingWindow,
  type BookingMode,
  type WholeDayVariant,
} from "@/lib/booking/policy";
import { ENABLE_CUSTOM_BOOKING } from "@/lib/booking/flags";
import { computeBookingPricing } from "@/lib/booking/pricing";
import {
  manualEntryColumns,
} from "@/components/admin/content";

const reservationTabs = [
  "Reservation Records",
  "Reschedule Requests",
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

const rescheduleRequestColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reservation Ref" },
  { key: "guest", label: "Guest" },
  { key: "oldCheckIn", label: "Old Check-in" },
  { key: "oldCheckOut", label: "Old Check-out" },
  { key: "newCheckIn", label: "New Check-in" },
  { key: "newCheckOut", label: "New Check-out" },
  { key: "status", label: "Status" },
  { key: "requestedAt", label: "Requested" },
];

interface ReservationRow {
  reservation_id: string;
  reference_number: string;
  guest_id: string | null;
  walk_in_guest_id?: string | null;
  start_datetime: string;
  end_datetime: string;
  booking_mode: "day" | "night" | "whole_day" | "custom" | null;
  adult_count: number;
  child_count: number;
  status: string;
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  created_at: string;
  booking_type: "online" | "walk_in" | null;
}

interface UnitRow {
  unit_id: string;
  name: string;
  capacity: number;
  base_price: number;
  is_active: boolean;
  archived_at: string | null;
}

interface ServiceRow {
  service_id: string;
  name: string;
  price: number;
  is_active: boolean;
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

interface WalkInGuestRow {
  walk_in_guest_id: string;
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

interface RescheduleRequestRow {
  reschedule_id: string;
  reservation_id: string;
  requested_by: string | null;
  old_start: string;
  old_end: string;
  new_start: string;
  new_end: string;
  status: "pending" | "approved" | "rejected";
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
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
  overpaid_amount: number | null;
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
  guest: GuestProfileRow | null;
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

interface GuestProfileRow {
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  email?: string | null;
  phone_number?: string | null;
  address?: string | null;
}

interface RescheduleRequestDetails {
  rescheduleId: string;
  reservationReference: string;
  guestName: string;
  requestedBy: string;
  oldCheckIn: string;
  oldCheckOut: string;
  newCheckIn: string;
  newCheckOut: string;
  status: string;
  approvedBy: string;
  approvedAt: string;
  rejectionReason: string;
  requestedAt: string;
}

interface PaymentDetails {
  reservationReference: string;
  paymentReference: string;
  method: string;
  type: string;
  amount: string;
  remainingBalance: string;
  overpaidAmount: string;
  status: string;
  paidAt: string;
  proofPath: string;
}

interface OcularVisitDetails {
  reference: string;
  guest: string;
  scheduledDate: string;
  timeSlot: string;
  status: string;
  createdAt: string;
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

interface ManualBookingForm {
  guestType: "existing" | "walk_in";
  guestId: string;
  firstName: string;
  lastName: string;
  middleName: string;
  email: string;
  phoneNumber: string;
  address: string;
  bookingMode: BookingMode;
  bookingDate: string;
  customEndDate: string;
  wholeDayVariant: WholeDayVariant;
  customStartTime: string;
  customEndTime: string;
  adultCount: string;
  childCount: string;
  unitId: string;
  specialRequests: string;
}

type ManualBookingStep = 1 | 2 | 3;
type ManualBookingPayOption = "downpayment" | "full";
type ManualBookingPaymentMethod = "cash" | "gcash" | "bank_transfer";

interface ManualBookingPaymentForm {
  payOption: ManualBookingPayOption;
  method: ManualBookingPaymentMethod;
  amount: string;
  paymentReference: string;
  accountName: string;
  accountNumber: string;
  proofFile: File | null;
}

type ManualBookingWindowResult = {
  bookingWindow?: {
    startDatetime: string;
    endDatetime: string;
    checkIn: string;
    checkOut: string;
    customDurationHours: number;
  };
  error?: string;
};

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

const parseLocalDateValue = (value: string) => {
  if (!value) return null;

  const parts = value.split("-");
  if (parts.length !== 3) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!year || !month || !day) return null;

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const reservationCancellationReasons = [
  "Guest requested for cancellation",
  "Maintenance",
  "Emergency Situation",
] as const;

type ReservationCancellationReason = (typeof reservationCancellationReasons)[number];

export default function AdminReservationsPage() {
  const [activeTab, setActiveTab] = useState<(typeof reservationTabs)[number]>("Reservation Records");
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedPaymentRowIds, setSelectedPaymentRowIds] = useState<string[]>([]);
  const [isManualPaymentDialogOpen, setIsManualPaymentDialogOpen] = useState(false);
  const [isCreatingManualPayment, setIsCreatingManualPayment] = useState(false);
  const [manualPaymentError, setManualPaymentError] = useState<string | null>(null);
  const [isManualBookingDialogOpen, setIsManualBookingDialogOpen] = useState(false);
  const [isCreatingManualBooking, setIsCreatingManualBooking] = useState(false);
  const [manualBookingError, setManualBookingError] = useState<string | null>(null);
  const [manualBookingStep, setManualBookingStep] = useState<ManualBookingStep>(1);
  const [availableUnits, setAvailableUnits] = useState<UnitRow[]>([]);
  const [availableServices, setAvailableServices] = useState<ServiceRow[]>([]);
  const [selectedManualServiceIds, setSelectedManualServiceIds] = useState<string[]>([]);
  const [walkInGuestsById, setWalkInGuestsById] = useState<Record<string, WalkInGuestRow>>({});
  const [guestDirectory, setGuestDirectory] = useState<GuestRow[]>([]);
  const [manualBookingForm, setManualBookingForm] = useState<ManualBookingForm>({
    guestType: "existing",
    guestId: "",
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phoneNumber: "",
    address: "",
    bookingMode: "day",
    bookingDate: toIsoLocalDay(new Date()),
    customEndDate: "",
    wholeDayVariant: "day_to_night",
    customStartTime: "08:00",
    customEndTime: "11:00",
    adultCount: "1",
    childCount: "0",
    unitId: "",
    specialRequests: "",
  });
  const [manualBookingPaymentForm, setManualBookingPaymentForm] = useState<ManualBookingPaymentForm>({
    payOption: "downpayment",
    method: "cash",
    amount: "",
    paymentReference: generatePaymentReference(),
    accountName: "",
    accountNumber: "",
    proofFile: null,
  });
  const [isReservationDetailsOpen, setIsReservationDetailsOpen] = useState(false);
  const [isReservationDetailsLoading, setIsReservationDetailsLoading] = useState(false);
  const [reservationDetailsError, setReservationDetailsError] = useState<string | null>(null);
  const [reservationDetails, setReservationDetails] = useState<ReservationDetails | null>(null);
  const [rescheduleRequests, setRescheduleRequests] = useState<RescheduleRequestRow[]>([]);
  const [isRescheduleDetailsOpen, setIsRescheduleDetailsOpen] = useState(false);
  const [isRescheduleDetailsLoading, setIsRescheduleDetailsLoading] = useState(false);
  const [rescheduleDetailsError, setRescheduleDetailsError] = useState<string | null>(null);
  const [rescheduleDetails, setRescheduleDetails] = useState<RescheduleRequestDetails | null>(null);
  const [pendingRescheduleApproval, setPendingRescheduleApproval] = useState<{ rescheduleId: string; reference: string } | null>(null);
  const [pendingRescheduleRejection, setPendingRescheduleRejection] = useState<{ rescheduleId: string; reference: string } | null>(null);
  const [rescheduleRejectionReason, setRescheduleRejectionReason] = useState("");
  const [isApprovingReschedule, setIsApprovingReschedule] = useState(false);
  const [isRejectingReschedule, setIsRejectingReschedule] = useState(false);
  const [isPaymentDetailsOpen, setIsPaymentDetailsOpen] = useState(false);
  const [paymentDetails, setPaymentDetails] = useState<PaymentDetails | null>(null);
  const [isOcularVisitDetailsOpen, setIsOcularVisitDetailsOpen] = useState(false);
  const [ocularVisitDetails, setOcularVisitDetails] = useState<OcularVisitDetails | null>(null);
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
  const [pendingReservationCancellation, setPendingReservationCancellation] = useState<{
    reservationId: string;
    reference: string;
  } | null>(null);
  const [reservationCancellationReason, setReservationCancellationReason] = useState<ReservationCancellationReason>(
    reservationCancellationReasons[0]
  );
  const [isCancellingReservation, setIsCancellingReservation] = useState(false);
  const [remainingBalanceByReservationId, setRemainingBalanceByReservationId] = useState<Record<string, number>>({});
  const [overpaidAmountByReservationId, setOverpaidAmountByReservationId] = useState<Record<string, number>>({});
  const [guestsById, setGuestsById] = useState<Record<string, GuestRow>>({});
  const [reservationReferenceById, setReservationReferenceById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToastMessage(null);
    }, 3000);

    return () => window.clearTimeout(timer);
  }, [toastMessage]);

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
            "reservation_id, reference_number, guest_id, walk_in_guest_id, start_datetime, end_datetime, booking_mode, adult_count, child_count, status, created_at, booking_type"
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
          ...new Set([
            ...reservationList.map((item) => item.guest_id).filter((id): id is string => Boolean(id)),
            ...ocularVisitList.map((item) => item.guest_id),
          ]),
        ];
        const walkInGuestIds = [
          ...new Set(reservationList.map((item) => item.walk_in_guest_id).filter((id): id is string => Boolean(id))),
        ];
        const reservationIdList = reservationList.map((item) => item.reservation_id);

        const [
          { data: guestsData, error: guestsError },
          { data: paymentsData, error: paymentsError },
          { data: transactionsData, error: transactionsError },
          { data: reschedulesData, error: reschedulesError },
          { data: unitsData, error: unitsError },
          { data: servicesData, error: servicesError },
          { data: walkInGuestsData, error: walkInGuestsError },
          { data: guestDirectoryData, error: guestDirectoryError },
        ] =
          await Promise.all([
            guestIds.length
              ? supabase.from("guests").select("id, first_name, last_name, email, phone_number, address, middle_name").in("id", guestIds)
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
                  ? supabase.from("transactions").select("reservation_id, balance, overpaid_amount").in("reservation_id", reservationIdList)
                  : Promise.resolve({ data: [], error: null }),
            supabase
              .from("reservation_reschedules")
              .select(
                "reschedule_id, reservation_id, requested_by, old_start, old_end, new_start, new_end, status, approved_by, approved_at, rejection_reason, created_at"
              )
              .order("created_at", { ascending: false })
              .limit(200),
            supabase
              .from("units")
              .select("unit_id, name, capacity, base_price, is_active, archived_at")
              .eq("is_active", true)
              .order("name", { ascending: true }),
            supabase
              .from("services")
              .select("service_id, name, price, is_active")
              .eq("is_active", true)
              .order("name", { ascending: true }),
            walkInGuestIds.length
              ? supabase
                  .from("walk_in_guests")
                  .select("walk_in_guest_id, first_name, last_name, middle_name, email, phone_number, address")
                  .in("walk_in_guest_id", walkInGuestIds)
              : Promise.resolve({ data: [], error: null }),
            supabase
              .from("guests")
              .select("id, first_name, last_name, middle_name, email, phone_number, address")
              .order("first_name", { ascending: true })
              .limit(500),
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

        if (reschedulesError) {
          throw reschedulesError;
        }

        if (unitsError) {
          throw unitsError;
        }

        if (servicesError) {
          throw servicesError;
        }

        if (walkInGuestsError) {
          throw walkInGuestsError;
        }

        if (guestDirectoryError) {
          throw guestDirectoryError;
        }

        if (!isMounted) return;

        const nextGuestsById = ((guestsData as GuestRow[] | null) ?? []).reduce<Record<string, GuestRow>>(
          (accumulator, guest) => {
            accumulator[guest.id] = guest;
            return accumulator;
          },
          {}
        );

        const nextWalkInGuestsById = ((walkInGuestsData as WalkInGuestRow[] | null) ?? []).reduce<
          Record<string, WalkInGuestRow>
        >((accumulator, guest) => {
          accumulator[guest.walk_in_guest_id] = guest;
          return accumulator;
        }, {});

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

        const nextOverpaidAmountByReservationId = (
          (transactionsData as TransactionBalanceRow[] | null) ?? []
        ).reduce<Record<string, number>>((accumulator, transaction) => {
          accumulator[transaction.reservation_id] = Number(transaction.overpaid_amount ?? 0);
          return accumulator;
        }, {});

        setReservations(reservationList);
        setPayments((paymentsData as PaymentRow[] | null) ?? []);
        setOcularVisits(ocularVisitList);
        setRescheduleRequests((reschedulesData as RescheduleRequestRow[] | null) ?? []);
        setAvailableUnits((unitsData as UnitRow[] | null) ?? []);
        setAvailableServices((servicesData as ServiceRow[] | null) ?? []);
        setGuestsById(nextGuestsById);
        setWalkInGuestsById(nextWalkInGuestsById);
        setReservationReferenceById(nextReservationReferenceById);
        setRemainingBalanceByReservationId(nextRemainingBalanceByReservationId);
        setOverpaidAmountByReservationId(nextOverpaidAmountByReservationId);
        setGuestDirectory((guestDirectoryData as GuestRow[] | null) ?? []);
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
        const guest = reservation.guest_id ? guestsById[reservation.guest_id] : null;
        const walkInGuest = reservation.walk_in_guest_id
          ? walkInGuestsById[reservation.walk_in_guest_id]
          : null;
        const displayGuest = guest ?? walkInGuest;
        const fallbackId = reservation.guest_id ?? reservation.walk_in_guest_id ?? "";
        const guestName = displayGuest
          ? `${displayGuest.first_name} ${displayGuest.last_name}`.replace(/\s+/g, " ").trim()
          : fallbackId
            ? `Guest ${fallbackId.slice(0, 8)}`
            : "Guest";

        return {
          id: reservation.reservation_id,
          reference: reservation.reference_number,
          guest: guestName,
          checkIn: formatDateTime(reservation.start_datetime),
          checkOut: formatDateTime(reservation.end_datetime),
          totalGuests: String((reservation.adult_count || 0) + (reservation.child_count || 0)),
          status: toTitleCase(reservation.status),
          createdAt: formatDateTime(reservation.created_at),
        };
      }),
    [guestsById, reservations, walkInGuestsById]
  );

  const rescheduleRequestRows: AdminTableRow[] = useMemo(
    () =>
      rescheduleRequests.map((request) => {
        const reservationReference = reservationReferenceById[request.reservation_id] ?? "-";
        const guest = guestsById[request.requested_by ?? ""];
        const guestName = guest ? `${guest.first_name} ${guest.last_name}`.replace(/\s+/g, " ").trim() : "-";

        return {
          id: request.reschedule_id,
          reference: reservationReference,
          guest: guestName,
          oldCheckIn: formatDate(request.old_start),
          oldCheckOut: formatDate(request.old_end),
          newCheckIn: formatDate(request.new_start),
          newCheckOut: formatDate(request.new_end),
          status: toTitleCase(request.status),
          requestedAt: formatDateTime(request.created_at),
        };
      }),
    [guestsById, reservationReferenceById, rescheduleRequests]
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
        overpaidAmount: formatCurrency(Number(overpaidAmountByReservationId[payment.reservation_id] ?? 0)),
        status: toTitleCase(payment.status),
        paidAt: formatDateTime(payment.paid_at),
        proofPath: payment.proof_path,
      })),
    [payments, reservationReferenceById, remainingBalanceByReservationId, overpaidAmountByReservationId]
  );

  const manualBookingRows: AdminTableRow[] = useMemo(
    () =>
      reservations
        .filter((reservation) => reservation.booking_type === "walk_in")
        .map((reservation) => {
          const guest = reservation.guest_id ? guestsById[reservation.guest_id] : null;
          const walkInGuest = reservation.walk_in_guest_id
            ? walkInGuestsById[reservation.walk_in_guest_id]
            : null;
          const displayGuest = guest ?? walkInGuest;
          const fallbackId = reservation.guest_id ?? reservation.walk_in_guest_id ?? "";
          const guestName = displayGuest
            ? `${displayGuest.first_name} ${displayGuest.last_name}`.replace(/\s+/g, " ").trim()
            : fallbackId
              ? `Guest ${fallbackId.slice(0, 8)}`
              : "Guest";

          return {
            id: reservation.reservation_id,
            reference: reservation.reference_number,
            encodedBy: "Staff",
            guest: guestName,
            guests: String((reservation.adult_count || 0) + (reservation.child_count || 0)),
            notes: `${toTitleCase(reservation.booking_mode ?? "custom")} booking`,
          };
        }),
    [guestsById, reservations, walkInGuestsById]
  );

  const openRescheduleDetails = async (rescheduleId: string) => {
    setIsRescheduleDetailsOpen(true);
    setIsRescheduleDetailsLoading(true);
    setRescheduleDetailsError(null);
    setRescheduleDetails(null);

    try {
      const supabase = createClient();

      const { data: requestRow, error: requestError } = await supabase
        .from("reservation_reschedules")
        .select(
          "reschedule_id, reservation_id, requested_by, old_start, old_end, new_start, new_end, status, approved_by, approved_at, rejection_reason, created_at"
        )
        .eq("reschedule_id", rescheduleId)
        .maybeSingle<RescheduleRequestRow>();

      if (requestError || !requestRow) {
        setRescheduleDetailsError("Reschedule request was not found.");
        return;
      }

      const reservationReference = reservationReferenceById[requestRow.reservation_id] ?? "-";
      const requester = guestsById[requestRow.requested_by ?? ""];

      setRescheduleDetails({
        rescheduleId: requestRow.reschedule_id,
        reservationReference,
        guestName: requester
          ? `${requester.first_name} ${requester.last_name}`.replace(/\s+/g, " ").trim()
          : "-",
        requestedBy: requester?.email ?? "-",
        oldCheckIn: formatDate(requestRow.old_start),
        oldCheckOut: formatDate(requestRow.old_end),
        newCheckIn: formatDate(requestRow.new_start),
        newCheckOut: formatDate(requestRow.new_end),
        status: toTitleCase(requestRow.status),
        approvedBy: requestRow.approved_by ?? "-",
        approvedAt: formatDateTime(requestRow.approved_at),
        rejectionReason: requestRow.rejection_reason ?? "-",
        requestedAt: formatDateTime(requestRow.created_at),
      });
    } catch {
      setRescheduleDetailsError("Failed to load reschedule request details.");
    } finally {
      setIsRescheduleDetailsLoading(false);
    }
  };

  const approveRescheduleRequest = async (rescheduleId: string) => {
    setFetchError(null);
    setIsApprovingReschedule(true);

    try {
      const response = await fetch("/api/admin/reschedule-requests/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rescheduleId }),
      });

      const result = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
            reservation?: {
              reservationId?: string;
              startDatetime?: string;
              endDatetime?: string;
              checkInDate?: string;
              checkOutDate?: string;
              status?: string;
            };
          }
        | null;

      if (!response.ok || !result?.success) {
        setFetchError(result?.message ?? "Failed to approve reschedule request.");
        return;
      }

      setRescheduleRequests((currentRequests) =>
        currentRequests.map((request) =>
          request.reschedule_id === rescheduleId
            ? {
                ...request,
                status: "approved",
                approved_by: null,
                approved_at: new Date().toISOString(),
                rejection_reason: null,
              }
            : request
        )
      );

      if (result?.reservation?.reservationId) {
        setReservations((currentReservations) =>
          currentReservations.map((reservation) =>
            reservation.reservation_id === result.reservation?.reservationId
              ? {
                  ...reservation,
                  ...(result.reservation?.startDatetime
                    ? { start_datetime: result.reservation.startDatetime }
                    : result.reservation?.checkInDate
                      ? { start_datetime: result.reservation.checkInDate }
                      : {}),
                  ...(result.reservation?.endDatetime
                    ? { end_datetime: result.reservation.endDatetime }
                    : result.reservation?.checkOutDate
                      ? { end_datetime: result.reservation.checkOutDate }
                      : {}),
                  ...(result.reservation?.status ? { status: result.reservation.status } : {}),
                }
              : reservation
          )
        );
      }

      setIsRescheduleDetailsOpen(false);
      setRescheduleDetails(null);
      setRescheduleRejectionReason("");
      setToastMessage("Reschedule request approved.");
    } catch {
      setFetchError("Failed to approve reschedule request.");
    } finally {
      setIsApprovingReschedule(false);
    }
  };

  const rejectRescheduleRequest = async (rescheduleId: string) => {
    if (!rescheduleRejectionReason.trim()) {
      setRescheduleDetailsError("Please provide a rejection reason.");
      return;
    }

    setFetchError(null);
    setIsRejectingReschedule(true);

    try {
      const response = await fetch("/api/admin/reschedule-requests/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rescheduleId, rejectionReason: rescheduleRejectionReason }),
      });

      const result = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
            reservation?: { reservationId?: string; status?: string };
          }
        | null;

      if (!response.ok || !result?.success) {
        setFetchError(result?.message ?? "Failed to reject reschedule request.");
        return;
      }

      setRescheduleRequests((currentRequests) =>
        currentRequests.map((request) =>
          request.reschedule_id === rescheduleId
            ? {
                ...request,
                status: "rejected",
                approved_by: null,
                approved_at: new Date().toISOString(),
                rejection_reason: rescheduleRejectionReason,
              }
            : request
        )
      );

      if (result?.reservation?.reservationId) {
        setReservations((currentReservations) =>
          currentReservations.map((reservation) =>
            reservation.reservation_id === result.reservation?.reservationId
              ? {
                  ...reservation,
                  ...(result.reservation?.status ? { status: result.reservation.status } : {}),
                }
              : reservation
          )
        );
      }

      setIsRescheduleDetailsOpen(false);
      setRescheduleDetails(null);
      setRescheduleRejectionReason("");
      setToastMessage("Reschedule request rejected.");
    } catch {
      setFetchError("Failed to reject reschedule request.");
    } finally {
      setIsRejectingReschedule(false);
    }
  };

  const handleRescheduleRowAction = async (action: string, row: AdminTableRow) => {
    const rescheduleId = typeof row.id === "string" ? row.id : "";

    if (!rescheduleId) {
      setFetchError("Unable to load this reschedule request.");
      return;
    }

    if (action === "View") {
      await openRescheduleDetails(rescheduleId);
      return;
    }

    if (action === "Approve") {
      await openRescheduleDetails(rescheduleId);
      void approveRescheduleRequest(rescheduleId);
      return;
    }

    if (action === "Reject") {
      await openRescheduleDetails(rescheduleId);
      setRescheduleRejectionReason("");
      return;
    }
  };

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

  const clearGuestProfileFields = () => ({
    guestId: "",
    firstName: "",
    lastName: "",
    middleName: "",
    email: "",
    phoneNumber: "",
    address: "",
  });

  const applyGuestProfile = (guest: GuestRow | null) => {
    setManualBookingForm((current) => ({
      ...current,
      guestId: guest?.id ?? "",
      firstName: guest?.first_name ?? "",
      lastName: guest?.last_name ?? "",
      middleName: guest?.middle_name ?? "",
      email: guest?.email ?? "",
      phoneNumber: guest?.phone_number ?? "",
      address: guest?.address ?? "",
    }));
  };

  const handleGuestTypeChange = (nextType: ManualBookingForm["guestType"]) => {
    setManualBookingForm((current) => ({
      ...current,
      guestType: nextType,
      ...clearGuestProfileFields(),
    }));
  };

  const handleGuestSelection = (guestId: string) => {
    const selectedGuest = guestDirectory.find((guest) => guest.id === guestId) ?? null;
    applyGuestProfile(selectedGuest);
  };

  const toggleManualServiceSelection = (serviceId: string) => {
    setSelectedManualServiceIds((current) =>
      current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId]
    );
  };

  const resetManualBookingPaymentForm = () => {
    setManualBookingPaymentForm({
      payOption: "downpayment",
      method: "cash",
      amount: "",
      paymentReference: generatePaymentReference(),
      accountName: "",
      accountNumber: "",
      proofFile: null,
    });
  };

  const resetManualBookingForm = () => {
    setManualBookingForm({
      guestType: "existing",
      guestId: "",
      firstName: "",
      lastName: "",
      middleName: "",
      email: "",
      phoneNumber: "",
      address: "",
      bookingMode: "day",
      bookingDate: toIsoLocalDay(new Date()),
      customEndDate: "",
      wholeDayVariant: "day_to_night",
      customStartTime: "08:00",
      customEndTime: "11:00",
      adultCount: "1",
      childCount: "0",
      unitId: availableUnits[0]?.unit_id ?? "",
      specialRequests: "",
    });
  };

  const handleManualBookingAction = (action: string) => {
    if (action !== "New Entry") {
      return;
    }

    setManualBookingError(null);
    resetManualBookingForm();
    resetManualBookingPaymentForm();
    setSelectedManualServiceIds([]);
    setManualBookingStep(1);
    setIsManualBookingDialogOpen(true);
  };

  const resolveManualBookingWindow = (): ManualBookingWindowResult => {
    const bookingDate = parseLocalDateValue(manualBookingForm.bookingDate);
    if (!bookingDate) {
      return { error: "Select a valid booking date." };
    }

    const customEndDate =
      manualBookingForm.bookingMode === "custom" && manualBookingForm.customEndDate
        ? parseLocalDateValue(manualBookingForm.customEndDate)
        : null;

    if (manualBookingForm.bookingMode === "custom" && manualBookingForm.customEndDate && !customEndDate) {
      return { error: "Select a valid custom end date." };
    }

    const bookingWindow = buildBookingWindow({
      bookingMode: manualBookingForm.bookingMode,
      date: bookingDate,
      wholeDayVariant:
        manualBookingForm.bookingMode === "whole_day" ? manualBookingForm.wholeDayVariant : undefined,
      customStartTime: manualBookingForm.bookingMode === "custom" ? manualBookingForm.customStartTime : undefined,
      customEndTime: manualBookingForm.bookingMode === "custom" ? manualBookingForm.customEndTime : undefined,
      customEndDate: customEndDate ?? undefined,
    });

    if ("error" in bookingWindow) {
      return { error: bookingWindow.error };
    }

    const validation = validateBookingWindow({
      bookingMode: manualBookingForm.bookingMode,
      startDatetime: bookingWindow.startDatetime,
      endDatetime: bookingWindow.endDatetime,
      wholeDayVariant: manualBookingForm.bookingMode === "whole_day" ? manualBookingForm.wholeDayVariant : null,
      customStartTime: manualBookingForm.bookingMode === "custom" ? manualBookingForm.customStartTime : null,
      customEndTime: manualBookingForm.bookingMode === "custom" ? manualBookingForm.customEndTime : null,
    });

    if (!validation.valid) {
      return { error: validation.message ?? "Invalid booking window." };
    }

    return { bookingWindow };
  };

  const manualBookingPreview = useMemo(() => resolveManualBookingWindow(), [manualBookingForm]);
  const isExistingGuest = manualBookingForm.guestType === "existing";

  const manualBookingParsedGuestCounts = useMemo(() => {
    const adults = Number(manualBookingForm.adultCount);
    const children = Number(manualBookingForm.childCount);
    return {
      adults,
      children,
      valid: Number.isInteger(adults) && adults > 0 && Number.isInteger(children) && children >= 0,
    };
  }, [manualBookingForm.adultCount, manualBookingForm.childCount]);

  const selectedManualUnit = useMemo(
    () => availableUnits.find((unit) => unit.unit_id === manualBookingForm.unitId) ?? null,
    [availableUnits, manualBookingForm.unitId]
  );

  const selectedManualServices = useMemo(
    () => availableServices.filter((service) => selectedManualServiceIds.includes(service.service_id)),
    [availableServices, selectedManualServiceIds]
  );

  const manualServicesTotal = useMemo(
    () => selectedManualServices.reduce((sum, service) => sum + Number(service.price ?? 0), 0),
    [selectedManualServices]
  );

  const manualBookingPricing = useMemo(() => {
    if (!manualBookingPreview.bookingWindow || !manualBookingParsedGuestCounts.valid) {
      return null;
    }

    return computeBookingPricing({
      bookingMode: manualBookingForm.bookingMode,
      startDatetime: manualBookingPreview.bookingWindow.startDatetime,
      endDatetime: manualBookingPreview.bookingWindow.endDatetime,
      adultCount: manualBookingParsedGuestCounts.adults,
      childCount: manualBookingParsedGuestCounts.children,
      servicesTotal: manualServicesTotal,
    });
  }, [manualBookingForm.bookingMode, manualBookingParsedGuestCounts, manualBookingPreview.bookingWindow, manualServicesTotal]);

  const manualBookingPayableAmounts = useMemo(() => {
    const total = Number(manualBookingPricing?.total ?? 0);
    const downPayment = Number(manualBookingPricing?.downPaymentMin ?? 0);
    const selected = manualBookingPaymentForm.payOption === "full" ? total : downPayment;

    return {
      total,
      downPayment,
      selected,
      remaining: Math.max(total - selected, 0),
    };
  }, [manualBookingPaymentForm.payOption, manualBookingPricing]);

  useEffect(() => {
    if (!manualBookingPricing) {
      return;
    }

    setManualBookingPaymentForm((current) => {
      const nextAmount =
        current.payOption === "full"
          ? manualBookingPricing.total.toFixed(2)
          : manualBookingPricing.downPaymentMin.toFixed(2);

      return {
        ...current,
        amount: nextAmount,
      };
    });
  }, [manualBookingPaymentForm.payOption, manualBookingPricing]);

  const validateManualBookingStepOne = () => {
    const isWalkInGuest = manualBookingForm.guestType === "walk_in";

    if (!isWalkInGuest && !manualBookingForm.guestId) {
      return "Select a guest account.";
    }

    if (isWalkInGuest) {
      if (!manualBookingForm.firstName.trim() || !manualBookingForm.lastName.trim()) {
        return "Enter the walk-in guest name.";
      }

      if (!manualBookingForm.email.trim() || !manualBookingForm.phoneNumber.trim()) {
        return "Enter the walk-in guest email and phone number.";
      }

      if (!manualBookingForm.address.trim()) {
        return "Enter the walk-in guest address.";
      }
    }

    return null;
  };

  const validateManualBookingStepTwo = () => {
    if (!manualBookingForm.bookingDate || !manualBookingForm.unitId) {
      return "Select a unit and booking date.";
    }

    if (!manualBookingParsedGuestCounts.valid) {
      return "Enter valid guest counts.";
    }

    if (!manualBookingPreview.bookingWindow) {
      return manualBookingPreview.error ?? "Invalid booking window.";
    }

    if (!selectedManualUnit) {
      return "Select a valid unit.";
    }

    return null;
  };

  const validateManualBookingPayment = () => {
    if (!manualBookingPricing) {
      return "Unable to compute reservation total.";
    }

    const parsedAmount = Number(manualBookingPaymentForm.amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return "Enter a valid payment amount.";
    }

    if (Math.abs(parsedAmount - manualBookingPayableAmounts.selected) > 0.01) {
      return "Payment amount must match the selected option.";
    }

    const requiresProof = manualBookingPaymentForm.method !== "cash";
    if (requiresProof) {
      if (!manualBookingPaymentForm.accountName.trim() || !manualBookingPaymentForm.accountNumber.trim()) {
        return "Account details are required for this payment method.";
      }

      if (!manualBookingPaymentForm.proofFile) {
        return "Screenshot of payment is required for this payment method.";
      }
    }

    return null;
  };

  const goToNextManualBookingStep = () => {
    if (manualBookingStep === 1) {
      const error = validateManualBookingStepOne();
      if (error) {
        setManualBookingError(error);
        return;
      }

      setManualBookingError(null);
      setManualBookingStep(2);
      return;
    }

    if (manualBookingStep === 2) {
      const error = validateManualBookingStepTwo();
      if (error) {
        setManualBookingError(error);
        return;
      }

      setManualBookingError(null);
      setManualBookingStep(3);
    }
  };

  const goToPreviousManualBookingStep = () => {
    setManualBookingError(null);
    setManualBookingStep((current) => (current > 1 ? ((current - 1) as ManualBookingStep) : current));
  };

  const handleCreateManualBooking = async () => {
    const stepOneError = validateManualBookingStepOne();
    if (stepOneError) {
      setManualBookingError(stepOneError);
      setManualBookingStep(1);
      return;
    }

    const stepTwoError = validateManualBookingStepTwo();
    if (stepTwoError) {
      setManualBookingError(stepTwoError);
      setManualBookingStep(2);
      return;
    }

    const paymentError = validateManualBookingPayment();
    if (paymentError) {
      setManualBookingError(paymentError);
      setManualBookingStep(3);
      return;
    }

    if (!manualBookingPreview.bookingWindow || !manualBookingPricing) {
      setManualBookingError("Unable to compute reservation totals.");
      return;
    }

    const parsedAdultCount = manualBookingParsedGuestCounts.adults;
    const parsedChildCount = manualBookingParsedGuestCounts.children;
    const parsedPaymentAmount = Number(manualBookingPaymentForm.amount);

    setManualBookingError(null);
    setIsCreatingManualBooking(true);

    try {
      let proofPath = "";
      const paymentMethod =
        manualBookingPaymentForm.method === "gcash" ? "e_wallet" : manualBookingPaymentForm.method;

      if (paymentMethod !== "cash" && manualBookingPaymentForm.proofFile) {
        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          setManualBookingError("Unable to resolve current staff session for proof upload.");
          return;
        }

        const safeFileName = manualBookingPaymentForm.proofFile.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
        proofPath = `${user.id}/${Date.now()}-${safeFileName}`;

        const { error: uploadError } = await supabase.storage
          .from("payment-proofs")
          .upload(proofPath, manualBookingPaymentForm.proofFile, {
            cacheControl: "3600",
            upsert: false,
          });

        if (uploadError) {
          setManualBookingError(uploadError.message || "Failed to upload payment screenshot.");
          return;
        }
      }

      const response = await fetch("/api/admin/reservations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          guestType: manualBookingForm.guestType,
          guestId: manualBookingForm.guestType === "existing" ? manualBookingForm.guestId : undefined,
          walkInGuest:
            manualBookingForm.guestType === "walk_in"
              ? {
                  firstName: manualBookingForm.firstName.trim(),
                  lastName: manualBookingForm.lastName.trim(),
                  middleName: manualBookingForm.middleName.trim() || undefined,
                  email: manualBookingForm.email.trim(),
                  phoneNumber: manualBookingForm.phoneNumber.trim(),
                  address: manualBookingForm.address.trim(),
                }
              : undefined,
          bookingMode: manualBookingForm.bookingMode,
              startDatetime: manualBookingPreview.bookingWindow.startDatetime,
              endDatetime: manualBookingPreview.bookingWindow.endDatetime,
          wholeDayVariant: manualBookingForm.bookingMode === "whole_day" ? manualBookingForm.wholeDayVariant : null,
          customStartTime: manualBookingForm.bookingMode === "custom" ? manualBookingForm.customStartTime : null,
          customEndTime: manualBookingForm.bookingMode === "custom" ? manualBookingForm.customEndTime : null,
          adultCount: parsedAdultCount,
          childCount: parsedChildCount,
          unitId: manualBookingForm.unitId,
          specialRequests: manualBookingForm.specialRequests,
          selectedServices: selectedManualServiceIds.map((serviceId) => ({
            serviceId,
            quantity: 1,
          })),
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
            reservation?: {
              id?: string;
            };
          }
        | null;

      if (!response.ok || !result?.success) {
        setManualBookingError(result?.message ?? "Failed to create manual reservation.");
        return;
      }

      const reservationId = result?.reservation?.id;

      if (!reservationId) {
        setManualBookingError("Manual reservation created without a reservation id.");
        return;
      }

      const paymentResponse = await fetch("/api/admin/payments/manual-entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId,
          amount: parsedPaymentAmount,
          paymentMethod,
          paymentReference: manualBookingPaymentForm.paymentReference,
          accountName: paymentMethod === "cash" ? undefined : manualBookingPaymentForm.accountName,
          accountNumber: paymentMethod === "cash" ? undefined : manualBookingPaymentForm.accountNumber,
          proofPath,
        }),
      });

      const paymentResult = (await paymentResponse.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
          }
        | null;

      if (!paymentResponse.ok || !paymentResult?.success) {
        setManualBookingError(paymentResult?.message ?? "Reservation created but failed to record payment.");
        return;
      }

      setIsManualBookingDialogOpen(false);
      setToastMessage(
        `Manual reservation created. Total ${formatCurrency(manualBookingPricing.total)} (${manualBookingPaymentForm.payOption === "full" ? "full payment" : "20% downpayment"}) recorded.`
      );
      window.location.reload();
    } catch {
      setManualBookingError("Failed to create manual reservation.");
    } finally {
      setIsCreatingManualBooking(false);
    }
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
    if (action === "View") {
      setPaymentDetails({
        reservationReference: row.reservationReference ?? "-",
        paymentReference: row.paymentReference ?? "-",
        method: row.method ?? "-",
        type: row.type ?? "-",
        amount: row.amount ?? "-",
        remainingBalance: row.remainingBalance ?? "-",
        overpaidAmount: (row as any).overpaidAmount ?? "-",
        status: row.status ?? "-",
        paidAt: row.paidAt ?? "-",
        proofPath: row.proofPath ?? "",
      });
      setIsPaymentDetailsOpen(true);
      return;
    }

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
      setToastMessage("This payment has no uploaded proof file.");
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(proofPath, 120);

    if (error || !data?.signedUrl) {
      setToastMessage("Unable to open payment proof image.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const handleReservationRowAction = async (action: string, row: AdminTableRow) => {
    if (action === "Cancel") {
      if (row.status === "Cancelled") {
        setFetchError("This reservation is already cancelled.");
        return;
      }

      if (row.status === "Completed") {
        setFetchError("Completed reservations can no longer be cancelled.");
        return;
      }

      const reservationId = typeof row.id === "string" ? row.id : "";

      if (!reservationId) {
        setFetchError("Unable to cancel this reservation.");
        return;
      }

      setFetchError(null);
      setReservationCancellationReason(reservationCancellationReasons[0]);
      setPendingReservationCancellation({
        reservationId,
        reference: row.reference ?? reservationId,
      });
      return;
    }

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
          "reservation_id, reference_number, guest_id, walk_in_guest_id, start_datetime, end_datetime, booking_mode, adult_count, child_count, status, cancelled_at, cancellation_reason, created_at, booking_type"
        )
        .eq("reservation_id", reservationId)
        .maybeSingle<ReservationRow>();

      if (reservationError || !reservation) {
        setReservationDetailsError("Reservation details were not found.");
        return;
      }

      const guestLookup = reservation.guest_id
        ? supabase
            .from("guests")
            .select("first_name, last_name, middle_name, email, phone_number, address")
            .eq("id", reservation.guest_id)
            .maybeSingle<GuestProfileRow>()
        : reservation.walk_in_guest_id
          ? supabase
              .from("walk_in_guests")
              .select("first_name, last_name, middle_name, email, phone_number, address")
              .eq("walk_in_guest_id", reservation.walk_in_guest_id)
              .maybeSingle<GuestProfileRow>()
          : Promise.resolve({ data: null, error: null });

      const [guestResult, unitsResult, servicesResult] = await Promise.all([
        guestLookup,
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

  const cancelReservation = async (reservationId: string, cancellationReason: ReservationCancellationReason) => {
    setFetchError(null);
    setIsCancellingReservation(true);

    try {
      const response = await fetch("/api/admin/reservations/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId,
          cancellationReason,
        }),
      });

      const result = (await response.json().catch(() => null)) as
        | { message?: string; reservationId?: string }
        | null;

      if (!response.ok) {
        setFetchError(result?.message ?? "Failed to cancel reservation.");
        return;
      }

      setReservations((currentReservations) =>
        currentReservations.map((reservation) =>
          reservation.reservation_id === reservationId
            ? {
                ...reservation,
                status: "cancelled",
              }
            : reservation
        )
      );

      setToastMessage(`Reservation ${pendingReservationCancellation?.reference ?? reservationId} cancelled.`);
      setPendingReservationCancellation(null);
    } catch {
      setFetchError("Failed to cancel reservation.");
    } finally {
      setIsCancellingReservation(false);
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
    if (action === "View") {
      setOcularVisitDetails({
        reference: row.reference ?? "-",
        guest: row.guest ?? "-",
        scheduledDate: row.scheduledDate ?? "-",
        timeSlot: row.timeSlot ?? "-",
        status: row.status ?? "-",
        createdAt: row.createdAt ?? "-",
      });
      setIsOcularVisitDetailsOpen(true);
      return;
    }

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

        {toastMessage ? (
          <div className="fixed bottom-4 right-4 z-60 rounded-xl border border-neutral/10 bg-neutral px-4 py-3 text-sm text-base shadow-xl">
            {toastMessage}
          </div>
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
            rowActions={["View", "Edit", "Cancel"]}
            onRowAction={handleReservationRowAction}
            isRowActionDisabled={(action, row) =>
              action === "Cancel" &&
              (row.status === "Cancelled" ||
                row.status === "Completed" ||
                (isCancellingReservation && pendingReservationCancellation?.reservationId === row.id))
            }
          />
        )}

        {activeTab === "Reschedule Requests" && (
          <AdminTablePreview
            title={isLoading ? "Reschedule Requests (Loading...)" : "Reschedule Requests"}
            columns={rescheduleRequestColumns}
            rows={rescheduleRequestRows}
            defaultSort={{ key: "requestedAt", direction: "desc" }}
            filters={[{ key: "status", label: "Status", options: ["Pending", "Approved", "Rejected"] }]}
            actions={[]}
            rowActions={["View"]}
            onRowAction={handleRescheduleRowAction}
          />
        )}

        {activeTab === "Payment Verification Queue" && (
          <AdminTablePreview
            title={isLoading ? "Payment Verification Queue (Loading..." : "Payment Verification Queue"}
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
            rowActions={["View", "Review", "Approve"]}
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
            rows={manualBookingRows}
            defaultSort={{ key: "reference", direction: "desc" }}
            filters={[
              {
                key: "encodedBy",
                label: "Encoded By",
                options: ["Staff"],
              },
            ]}
            actions={["New Entry"]}
            onAction={handleManualBookingAction}
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

      {pendingReservationCancellation ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-neutral">Cancel Reservation</h3>
            <p className="mt-1 text-sm text-neutral/70">
              Reservation {pendingReservationCancellation.reference} will be marked as cancelled.
            </p>

            <div className="mt-5">
              <label className="mb-2 block text-sm text-neutral/70">Cancellation Reason</label>
              <select
                value={reservationCancellationReason}
                onChange={(event) =>
                  setReservationCancellationReason(event.target.value as ReservationCancellationReason)
                }
                className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
              >
                {reservationCancellationReasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                disabled={isCancellingReservation}
                onClick={() => {
                  if (!isCancellingReservation) {
                    setPendingReservationCancellation(null);
                  }
                }}
                className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
              >
                Close
              </button>
              <button
                type="button"
                disabled={isCancellingReservation}
                onClick={() => {
                  void cancelReservation(
                    pendingReservationCancellation.reservationId,
                    reservationCancellationReason
                  );
                }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCancellingReservation ? "Cancelling..." : "Confirm Cancellation"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isManualBookingDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-neutral">New Manual Booking Entry</h3>
            <p className="mt-1 text-sm text-neutral/70">
              Step through guest details, reservation schedule, and payment capture in one flow.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-base p-2">
              {[
                { step: 1 as ManualBookingStep, label: "Guest" },
                { step: 2 as ManualBookingStep, label: "Reservation" },
                { step: 3 as ManualBookingStep, label: "Payment" },
              ].map((item) => {
                const isActive = manualBookingStep === item.step;
                const isComplete = manualBookingStep > item.step;
                return (
                  <div
                    key={item.step}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
                      isActive
                        ? "bg-primary text-base"
                        : isComplete
                          ? "bg-secondary/20 text-neutral"
                          : "bg-white text-neutral/50"
                    }`}
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-current text-xs">
                      {isComplete ? "✓" : item.step}
                    </span>
                    <span>{item.label}</span>
                  </div>
                );
              })}
            </div>

            {manualBookingError ? (
              <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                {manualBookingError}
              </p>
            ) : null}

            {manualBookingStep === 1 ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-neutral/70">Guest Type</label>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-neutral">
                      <input
                        type="radio"
                        name="manualGuestType"
                        value="existing"
                        checked={manualBookingForm.guestType === "existing"}
                        onChange={() => handleGuestTypeChange("existing")}
                      />
                      Existing Account
                    </label>
                    <label className="flex items-center gap-2 text-sm text-neutral">
                      <input
                        type="radio"
                        name="manualGuestType"
                        value="walk_in"
                        checked={manualBookingForm.guestType === "walk_in"}
                        onChange={() => handleGuestTypeChange("walk_in")}
                      />
                      Walk-in Guest
                    </label>
                  </div>
                </div>

                {isExistingGuest ? (
                  <div className="md:col-span-2">
                    <label className="mb-2 block text-sm text-neutral/70">Select Guest Account</label>
                    <select
                      value={manualBookingForm.guestId}
                      onChange={(event) => handleGuestSelection(event.target.value)}
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                    >
                      <option value="">Select a guest</option>
                      {guestDirectory.map((guest) => {
                        const name = `${guest.first_name} ${guest.last_name}`.replace(/\s+/g, " ").trim();
                        const label = guest.email ? `${name} • ${guest.email}` : name;
                        return (
                          <option key={guest.id} value={guest.id}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ) : null}

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">First Name</label>
                  <input
                    type="text"
                    value={manualBookingForm.firstName}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, firstName: event.target.value }))
                    }
                    readOnly={isExistingGuest}
                    className={`w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm ${isExistingGuest ? "bg-base" : ""}`}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Last Name</label>
                  <input
                    type="text"
                    value={manualBookingForm.lastName}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, lastName: event.target.value }))
                    }
                    readOnly={isExistingGuest}
                    className={`w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm ${isExistingGuest ? "bg-base" : ""}`}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Middle Name</label>
                  <input
                    type="text"
                    value={manualBookingForm.middleName}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, middleName: event.target.value }))
                    }
                    readOnly={isExistingGuest}
                    className={`w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm ${isExistingGuest ? "bg-base" : ""}`}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Email</label>
                  <input
                    type="email"
                    value={manualBookingForm.email}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, email: event.target.value }))
                    }
                    readOnly={isExistingGuest}
                    className={`w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm ${isExistingGuest ? "bg-base" : ""}`}
                    placeholder={isExistingGuest ? "" : "guest@example.com"}
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Phone Number</label>
                  <input
                    type="text"
                    value={manualBookingForm.phoneNumber}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, phoneNumber: event.target.value }))
                    }
                    readOnly={isExistingGuest}
                    className={`w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm ${isExistingGuest ? "bg-base" : ""}`}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-neutral/70">Address</label>
                  <input
                    type="text"
                    value={manualBookingForm.address}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, address: event.target.value }))
                    }
                    readOnly={isExistingGuest}
                    className={`w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm ${isExistingGuest ? "bg-base" : ""}`}
                  />
                </div>
              </div>
            ) : null}

            {manualBookingStep === 2 ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Booking Mode</label>
                  <select
                    value={manualBookingForm.bookingMode}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({
                        ...current,
                        bookingMode: event.target.value as ManualBookingForm["bookingMode"],
                      }))
                    }
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                  >
                    <option value="day">Day</option>
                    <option value="night">Night</option>
                    <option value="whole_day">Whole Day</option>
                    {ENABLE_CUSTOM_BOOKING ? <option value="custom">Custom</option> : null}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Unit</label>
                  <select
                    value={manualBookingForm.unitId}
                    onChange={(event) => setManualBookingForm((current) => ({ ...current, unitId: event.target.value }))}
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                  >
                    <option value="">Select a unit</option>
                    {availableUnits.map((unit) => (
                      <option key={unit.unit_id} value={unit.unit_id}>
                        {unit.name} ({unit.capacity} pax)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Booking Date</label>
                  <input
                    type="date"
                    value={manualBookingForm.bookingDate}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, bookingDate: event.target.value }))
                    }
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                  />
                </div>

                {manualBookingForm.bookingMode === "whole_day" ? (
                  <div>
                    <label className="mb-2 block text-sm text-neutral/70">Whole Day Variant</label>
                    <select
                      value={manualBookingForm.wholeDayVariant}
                      onChange={(event) =>
                        setManualBookingForm((current) => ({
                          ...current,
                          wholeDayVariant: event.target.value as ManualBookingForm["wholeDayVariant"],
                        }))
                      }
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                    >
                      <option value="day_to_night">Day to Night</option>
                      <option value="night_to_day">Night to Day</option>
                    </select>
                  </div>
                ) : null}

                {manualBookingForm.bookingMode === "custom" ? (
                  <>
                    <div>
                      <label className="mb-2 block text-sm text-neutral/70">Custom End Date</label>
                      <input
                        type="date"
                        value={manualBookingForm.customEndDate}
                        min={manualBookingForm.bookingDate || undefined}
                        onChange={(event) =>
                          setManualBookingForm((current) => ({ ...current, customEndDate: event.target.value }))
                        }
                        className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-neutral/70">Custom Start Time</label>
                      <input
                        type="time"
                        value={manualBookingForm.customStartTime}
                        onChange={(event) =>
                          setManualBookingForm((current) => ({ ...current, customStartTime: event.target.value }))
                        }
                        className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-neutral/70">Custom End Time</label>
                      <input
                        type="time"
                        value={manualBookingForm.customEndTime}
                        onChange={(event) =>
                          setManualBookingForm((current) => ({ ...current, customEndTime: event.target.value }))
                        }
                        className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                      />
                    </div>
                  </>
                ) : null}

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Adults</label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={manualBookingForm.adultCount}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, adultCount: event.target.value }))
                    }
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Children</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={manualBookingForm.childCount}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, childCount: event.target.value }))
                    }
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-neutral/70">Calculated Booking Window</label>
                  <div className="rounded-lg border border-neutral/10 bg-base px-3 py-3 text-sm text-neutral/80">
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="text-xs text-neutral/60">Check-in</p>
                        <p className="font-semibold text-neutral">
                          {manualBookingPreview.bookingWindow
                            ? formatDateTime(manualBookingPreview.bookingWindow.startDatetime)
                            : "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-neutral/60">Check-out</p>
                        <p className="font-semibold text-neutral">
                          {manualBookingPreview.bookingWindow
                            ? formatDateTime(manualBookingPreview.bookingWindow.endDatetime)
                            : "-"}
                        </p>
                      </div>
                    </div>
                    {manualBookingPreview.error ? (
                      <p className="mt-2 text-xs text-highlight">{manualBookingPreview.error}</p>
                    ) : null}
                  </div>
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-neutral/70">Special Requests</label>
                  <textarea
                    value={manualBookingForm.specialRequests}
                    onChange={(event) =>
                      setManualBookingForm((current) => ({ ...current, specialRequests: event.target.value }))
                    }
                    rows={4}
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                    placeholder="Optional notes for the reservation"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-neutral/70">Add-on Services</label>
                  {availableServices.length === 0 ? (
                    <p className="rounded-lg border border-neutral/10 bg-base px-3 py-2 text-xs text-neutral/70">
                      No active services available.
                    </p>
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2">
                      {availableServices.map((service) => {
                        const checked = selectedManualServiceIds.includes(service.service_id);
                        return (
                          <label
                            key={service.service_id}
                            className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                              checked ? "border-primary bg-primary/5" : "border-neutral/20"
                            }`}
                          >
                            <span className="flex items-center gap-2 text-neutral">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleManualServiceSelection(service.service_id)}
                              />
                              {service.name}
                            </span>
                            <span className="font-semibold text-neutral">{formatCurrency(Number(service.price ?? 0))}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {manualBookingStep === 3 ? (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 rounded-xl border border-neutral/10 bg-base p-4">
                  <h4 className="text-sm font-semibold text-neutral">Transaction Summary</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
                    <p>
                      Guest: <span className="font-semibold text-neutral">{`${manualBookingForm.firstName} ${manualBookingForm.lastName}`.trim() || "-"}</span>
                    </p>
                    <p>
                      Unit: <span className="font-semibold text-neutral">{selectedManualUnit?.name ?? "-"}</span>
                    </p>
                    <p>
                      Check-in: <span className="font-semibold text-neutral">{manualBookingPreview.bookingWindow ? formatDateTime(manualBookingPreview.bookingWindow.startDatetime) : "-"}</span>
                    </p>
                    <p>
                      Check-out: <span className="font-semibold text-neutral">{manualBookingPreview.bookingWindow ? formatDateTime(manualBookingPreview.bookingWindow.endDatetime) : "-"}</span>
                    </p>
                    <p>
                      Guests: <span className="font-semibold text-neutral">{manualBookingParsedGuestCounts.valid ? `${manualBookingParsedGuestCounts.adults + manualBookingParsedGuestCounts.children} pax` : "-"}</span>
                    </p>
                    <p>
                      Pricing Tier: <span className="font-semibold text-neutral">{manualBookingPricing ? toTitleCase(manualBookingPricing.rateTier) : "-"}</span>
                    </p>
                  </div>
                  <div className="mt-3 space-y-1 border-t border-neutral/10 pt-3 text-sm text-neutral/80">
                    <div className="flex items-center justify-between">
                      <span>Package</span>
                      <span className="font-semibold text-neutral">{manualBookingPricing ? formatCurrency(manualBookingPricing.packageRate) : "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Extra Guest Charges</span>
                      <span className="font-semibold text-neutral">{manualBookingPricing ? formatCurrency(manualBookingPricing.extraGuestTotal) : "-"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Services</span>
                      <span className="font-semibold text-neutral">{formatCurrency(manualServicesTotal)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-neutral/10 pt-2">
                      <span className="font-semibold">Total Transaction</span>
                      <span className="font-bold text-primary">{formatCurrency(manualBookingPayableAmounts.total)}</span>
                    </div>
                  </div>
                  {selectedManualServices.length ? (
                    <div className="mt-3 border-t border-neutral/10 pt-3 text-xs text-neutral/70">
                      <p className="mb-1 font-semibold text-neutral">Selected Services</p>
                      <ul className="space-y-1">
                        {selectedManualServices.map((service) => (
                          <li key={service.service_id} className="flex items-center justify-between">
                            <span>{service.name}</span>
                            <span>{formatCurrency(Number(service.price ?? 0))}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm text-neutral/70">Payment Option</label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <button
                      type="button"
                      onClick={() =>
                        setManualBookingPaymentForm((current) => ({
                          ...current,
                          payOption: "downpayment",
                        }))
                      }
                      className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                        manualBookingPaymentForm.payOption === "downpayment"
                          ? "border-primary bg-primary/5"
                          : "border-neutral/20"
                      }`}
                    >
                      <p className="font-semibold text-neutral">20% Downpayment</p>
                      <p className="text-neutral/70">{formatCurrency(manualBookingPayableAmounts.downPayment)}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setManualBookingPaymentForm((current) => ({
                          ...current,
                          payOption: "full",
                        }))
                      }
                      className={`rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                        manualBookingPaymentForm.payOption === "full" ? "border-primary bg-primary/5" : "border-neutral/20"
                      }`}
                    >
                      <p className="font-semibold text-neutral">Full Payment</p>
                      <p className="text-neutral/70">{formatCurrency(manualBookingPayableAmounts.total)}</p>
                    </button>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Payment Method</label>
                  <select
                    value={manualBookingPaymentForm.method}
                    onChange={(event) =>
                      setManualBookingPaymentForm((current) => ({
                        ...current,
                        method: event.target.value as ManualBookingPaymentMethod,
                        accountName: "",
                        accountNumber: "",
                        proofFile: null,
                      }))
                    }
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="gcash">GCash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Payment Reference</label>
                  <input
                    value={manualBookingPaymentForm.paymentReference}
                    onChange={(event) =>
                      setManualBookingPaymentForm((current) => ({
                        ...current,
                        paymentReference: event.target.value,
                      }))
                    }
                    className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Amount To Record</label>
                  <input
                    value={formatCurrency(manualBookingPayableAmounts.selected)}
                    readOnly
                    className="w-full rounded-lg border border-neutral/20 bg-base px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Remaining After Payment</label>
                  <input
                    value={formatCurrency(manualBookingPayableAmounts.remaining)}
                    readOnly
                    className="w-full rounded-lg border border-neutral/20 bg-base px-3 py-2 text-sm"
                  />
                </div>

                {manualBookingPaymentForm.method !== "cash" ? (
                  <>
                    <div>
                      <label className="mb-2 block text-sm text-neutral/70">Account Name</label>
                      <input
                        value={manualBookingPaymentForm.accountName}
                        onChange={(event) =>
                          setManualBookingPaymentForm((current) => ({
                            ...current,
                            accountName: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-neutral/70">
                        {manualBookingPaymentForm.method === "bank_transfer" ? "Reference Number" : "GCash Number"}
                      </label>
                      <input
                        value={manualBookingPaymentForm.accountNumber}
                        onChange={(event) =>
                          setManualBookingPaymentForm((current) => ({
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
                          setManualBookingPaymentForm((current) => ({
                            ...current,
                            proofFile: event.target.files?.[0] ?? null,
                          }))
                        }
                        className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                      />
                      {manualBookingPaymentForm.proofFile ? (
                        <p className="mt-2 text-xs text-neutral/70">Selected: {manualBookingPaymentForm.proofFile.name}</p>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 flex justify-between gap-3">
              <div>
                {manualBookingStep > 1 ? (
                  <button
                    type="button"
                    disabled={isCreatingManualBooking}
                    onClick={goToPreviousManualBookingStep}
                    className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Back
                  </button>
                ) : null}
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={isCreatingManualBooking}
                  onClick={() => {
                    if (!isCreatingManualBooking) {
                      setIsManualBookingDialogOpen(false);
                    }
                  }}
                  className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>

                {manualBookingStep < 3 ? (
                  <button
                    type="button"
                    disabled={isCreatingManualBooking}
                    onClick={goToNextManualBookingStep}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isCreatingManualBooking}
                    onClick={() => {
                      void handleCreateManualBooking();
                    }}
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isCreatingManualBooking ? "Saving..." : "Create Reservation"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isManualPaymentDialogOpen && selectedPaymentRow ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
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

      {isRescheduleDetailsOpen && rescheduleDetails ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral">Reschedule Request Details</h3>
                <p className="mt-1 text-sm text-neutral/70">Review the requested date change before approving or rejecting.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsRescheduleDetailsOpen(false);
                  setRescheduleDetails(null);
                  setRescheduleDetailsError(null);
                  setRescheduleRejectionReason("");
                }}
                className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
              >
                Close
              </button>
            </div>

            {isRescheduleDetailsLoading ? <p className="mt-5 text-sm text-neutral/70">Loading reschedule details...</p> : null}

            {rescheduleDetailsError ? (
              <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                {rescheduleDetailsError}
              </p>
            ) : null}

            {!isRescheduleDetailsLoading ? (
              <div className="mt-5 space-y-6">
                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Request Summary</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
                    <p>
                      Reservation Ref: <span className="font-semibold text-neutral">{rescheduleDetails.reservationReference}</span>
                    </p>
                    <p>
                      Status: <span className="font-semibold text-neutral">{rescheduleDetails.status}</span>
                    </p>
                    <p>
                      Requested By: <span className="font-semibold text-neutral">{rescheduleDetails.guestName}</span>
                    </p>
                    <p>
                      Requester Email: <span className="font-semibold text-neutral">{rescheduleDetails.requestedBy}</span>
                    </p>
                    <p>
                      Requested At: <span className="font-semibold text-neutral">{rescheduleDetails.requestedAt}</span>
                    </p>
                    <p>
                      Approved At: <span className="font-semibold text-neutral">{rescheduleDetails.approvedAt}</span>
                    </p>
                    <p>
                      Approved By: <span className="font-semibold text-neutral">{rescheduleDetails.approvedBy}</span>
                    </p>
                    <p>
                      Rejection Reason: <span className="font-semibold text-neutral">{rescheduleDetails.rejectionReason}</span>
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Old Dates</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
                    <p>
                      Check-in: <span className="font-semibold text-neutral">{rescheduleDetails.oldCheckIn}</span>
                    </p>
                    <p>
                      Check-out: <span className="font-semibold text-neutral">{rescheduleDetails.oldCheckOut}</span>
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-neutral/10 p-4">
                  <h4 className="text-sm font-semibold text-neutral">Requested New Dates</h4>
                  <div className="mt-3 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
                    <p>
                      Check-in: <span className="font-semibold text-neutral">{rescheduleDetails.newCheckIn}</span>
                    </p>
                    <p>
                      Check-out: <span className="font-semibold text-neutral">{rescheduleDetails.newCheckOut}</span>
                    </p>
                  </div>
                </section>

                {rescheduleDetails.status === "Pending" ? (
                  <section className="rounded-xl border border-neutral/10 p-4">
                    <label className="mb-2 block text-sm font-semibold text-neutral">Rejection Reason</label>
                    <textarea
                      value={rescheduleRejectionReason}
                      onChange={(event) => setRescheduleRejectionReason(event.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-sm"
                      placeholder="Explain why the request is being rejected"
                    />
                  </section>
                ) : null}

                <div className="flex flex-wrap justify-end gap-3">
                  <button
                    type="button"
                    disabled={isApprovingReschedule || rescheduleDetails.status !== "Pending"}
                    onClick={() => {
                      void approveRescheduleRequest(rescheduleDetails.rescheduleId);
                    }}
                    className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold text-base hover:bg-secondary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isApprovingReschedule ? "Approving..." : "Approve Request"}
                  </button>
                  <button
                    type="button"
                    disabled={isRejectingReschedule || rescheduleDetails.status !== "Pending"}
                    onClick={() => {
                      void rejectRescheduleRequest(rescheduleDetails.rescheduleId);
                    }}
                    className="rounded-lg border border-highlight/40 bg-highlight/10 px-4 py-2 text-sm font-semibold text-neutral hover:bg-highlight/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isRejectingReschedule ? "Rejecting..." : "Reject Request"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isPaymentDetailsOpen && paymentDetails ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral">Payment Details</h3>
                <p className="mt-1 text-sm text-neutral/70">Verification details for the selected payment.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsPaymentDetailsOpen(false);
                }}
                className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
              <p>
                Reservation Ref: <span className="font-semibold text-neutral">{paymentDetails.reservationReference}</span>
              </p>
              <p>
                Payment Ref: <span className="font-semibold text-neutral">{paymentDetails.paymentReference}</span>
              </p>
              <p>
                Method: <span className="font-semibold text-neutral">{paymentDetails.method}</span>
              </p>
              <p>
                Type: <span className="font-semibold text-neutral">{paymentDetails.type}</span>
              </p>
              <p>
                Amount: <span className="font-semibold text-neutral">{paymentDetails.amount}</span>
              </p>
              <p>
                Remaining Balance: <span className="font-semibold text-neutral">{paymentDetails.remainingBalance}</span>
              </p>
              <p>
                Status: <span className="font-semibold text-neutral">{paymentDetails.status}</span>
              </p>
              <p>
                Paid At: <span className="font-semibold text-neutral">{paymentDetails.paidAt}</span>
              </p>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (!paymentDetails.proofPath) {
                    setToastMessage("This payment has no uploaded proof file.");
                    return;
                  }

                  void (async () => {
                    const supabase = createClient();
                    const { data, error } = await supabase.storage
                      .from("payment-proofs")
                      .createSignedUrl(paymentDetails.proofPath, 120);

                    if (error || !data?.signedUrl) {
                      setToastMessage("Unable to open payment proof image.");
                      return;
                    }

                    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
                  })();
                }}
                className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-medium text-neutral hover:bg-base"
              >
                Open Proof Image
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isOcularVisitDetailsOpen && ocularVisitDetails ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-neutral">Ocular Visit Details</h3>
                <p className="mt-1 text-sm text-neutral/70">Complete details for the selected ocular appointment.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOcularVisitDetailsOpen(false);
                }}
                className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-2 text-sm text-neutral/80 md:grid-cols-2">
              <p>
                Reference: <span className="font-semibold text-neutral">{ocularVisitDetails.reference}</span>
              </p>
              <p>
                Guest: <span className="font-semibold text-neutral">{ocularVisitDetails.guest}</span>
              </p>
              <p>
                Scheduled Date: <span className="font-semibold text-neutral">{ocularVisitDetails.scheduledDate}</span>
              </p>
              <p>
                Time Slot: <span className="font-semibold text-neutral">{ocularVisitDetails.timeSlot}</span>
              </p>
              <p>
                Status: <span className="font-semibold text-neutral">{ocularVisitDetails.status}</span>
              </p>
              <p>
                Created: <span className="font-semibold text-neutral">{ocularVisitDetails.createdAt}</span>
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isReservationDetailsOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
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
                      Check-in: <span className="font-semibold text-neutral">{formatDate(reservationDetails.reservation.start_datetime)}</span>
                    </p>
                    <p>
                      Check-out: <span className="font-semibold text-neutral">{formatDate(reservationDetails.reservation.end_datetime)}</span>
                    </p>
                    <p>
                      Adults: <span className="font-semibold text-neutral">{reservationDetails.reservation.adult_count}</span>
                    </p>
                    <p>
                      Children: <span className="font-semibold text-neutral">{reservationDetails.reservation.child_count}</span>
                    </p>
                    <p>
                      Total Guests: <span className="font-semibold text-neutral">{(reservationDetails.reservation.adult_count || 0) + (reservationDetails.reservation.child_count || 0)}</span>
                    </p>
                    <p>
                      Booking Type: <span className="font-semibold text-neutral">{toTitleCase(reservationDetails.reservation.booking_type ?? "online")}</span>
                    </p>
                    <p>
                      Booking Mode: <span className="font-semibold text-neutral">{toTitleCase(reservationDetails.reservation.booking_mode ?? "day")}</span>
                    </p>
                    <p>
                      Cancellation Reason: <span className="font-semibold text-neutral">{reservationDetails.reservation.cancellation_reason ?? "-"}</span>
                    </p>
                    <p>
                      Cancelled At: <span className="font-semibold text-neutral">{formatDateTime(reservationDetails.reservation.cancelled_at ?? null)}</span>
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
