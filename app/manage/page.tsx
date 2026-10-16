"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import ConfirmationDialog from "@/components/ui/ConfirmationDialog";
import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";
import { downPaymentAmount } from "@/lib/booking/payment-policy";
import { BOOKING_LEAD_MESSAGE, isBookingStartAllowed, isOcularSlotStartAllowed } from "@/lib/booking/start-time";
import { manilaDateKey } from "@/lib/booking/manila-date";
import GuestRefundStatus from "@/components/GuestRefundStatus";
import CancellationDialog from "@/components/CancellationDialog";
import ManageIcon from "@/components/manage/ManageIcon";
import RecordActionsMenu from "@/components/manage/RecordActionsMenu";
import RecordDialog from "@/components/manage/RecordDialog";
import GuestBookingEditor from "@/components/manage/GuestBookingEditor";
import RescheduleCalendar from "@/components/manage/RescheduleCalendar";
import { moveReservationToDate } from "@/lib/booking/reservation-edit";
import { useGuestRescheduleAvailability } from "@/lib/booking/use-guest-reschedule-availability";
import { reschedulePolicy, RESCHEDULE_POLICY_TEXT, RESCHEDULE_FEE_TEXT } from "@/lib/booking/reschedule-charge-policy";

type ManageTab = "bookings" | "ocular" | "refunds";
type RecordMode = "view" | "edit" | "reschedule" | null;

interface BookingRecord {
  id: string;
  reference: string;
  startDatetime: string;
  endDatetime: string;
  checkIn: string;
  checkOut: string;
  bookingMode: "day" | "night" | "whole_day" | "custom" | null;
  guests: number;
  adultCount: number;
  childCount: number;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  status: string;
  paymentDeadlineAt: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  cancellationOutcome?: string;
  email: string;
  phone: string;
}

interface RescheduleFormState {
  checkIn: string;
}

interface EditableReservationService {
  serviceId: string;
  name: string;
  quantity: number;
  minQuantity: number;
  priceAtTime: number;
}

interface OcularRecord {
  id: string;
  reference: string;
  scheduledDate: string;
  timeSlot: string;
  timeSlotId: string;
  status: string;
  notes: string;
}

interface ReservationRow {
  reservation_id: string;
  reference_number: string;
  start_datetime: string;
  end_datetime: string;
  booking_mode: "day" | "night" | "whole_day" | "custom" | null;
  adult_count: number;
  child_count: number;
  status: string;
  payment_deadline_at: string | null;
  checked_in_at?: string | null;
  checked_out_at?: string | null;
  cancellation_snapshot?: { outcome?: string } | null;
}

interface TransactionRow {
  reservation_id: string;
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
}

interface OcularVisitRow {
  visit_id: string;
  reference_number: string;
  scheduled_date: string;
  time_slot_id: string | null;
  status: string;
  created_at: string;
}

interface GuestRow {
  email: string;
  phone_number: string;
}

interface ReservationServiceRow {
  reservation_id: string;
  service_id: string;
  quantity: number;
  price_at_time: number;
  services:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

interface OcularTimeSlotRow {
  slot_id: string;
  start_time: string;
  end_time: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

const isClosedReservation = (status: string) =>
  ["cancelled", "completed", "expired", "rejected"].includes(status.toLowerCase());

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatDateTime = (value: string) => {

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

};

const toTitleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

const formatTimeSlot = (slot: string) => {
  if (!slot.includes("-")) return slot;

  const [start, end] = slot.split("-");

  const toLabel = (time: string) => {
    const [hourRaw, minute] = time.split(":");
    const hour = Number(hourRaw);
    if (Number.isNaN(hour) || !minute) return time;

    const period = hour >= 12 ? "PM" : "AM";
    const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${normalizedHour}:${minute} ${period}`;
  };

  return `${toLabel(start)} - ${toLabel(end)}`;
};

const toDateTimeLocal = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  const hours = `${parsed.getHours()}`.padStart(2, "0");
  const minutes = `${parsed.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getMinRescheduleDate = (booking: BookingRecord | null) => {
  const today = manilaDateKey(new Date());
  if (!booking?.startDatetime) return today;
  const moved = moveReservationToDate({ start_datetime: booking.startDatetime, end_datetime: booking.endDatetime }, today);
  if (isBookingStartAllowed(moved.startDatetime)) return today;
  return manilaDateKey(new Date(new Date(`${today}T00:00:00+08:00`).getTime() + 86_400_000));
};

export default function ManageBooking() {
  const router = useRouter();
  const recordsPanel = useRef<HTMLDivElement>(null);
  const refundsTab = useRef<HTMLButtonElement>(null);
  const bookingRevision = useRef(0);
  const setBookingDraft = useBookingStore((state) => state.setBookingDraft);
  const [activeTab, setActiveTab] = useState<ManageTab>("bookings");
  const [search, setSearch] = useState("");
  const [ocularMessage, setOcularMessage] = useState<string | null>(null);
  const [recordMode, setRecordMode] = useState<RecordMode>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancellationMessage, setCancellationMessage] = useState<string | null>(null);
  const [refundRefresh, setRefundRefresh] = useState(0);
  const [pendingCancellation, setPendingCancellation] = useState<{ id: string; reference: string; checkIn: string } | null>(null);
  const [pendingOcularCancellation, setPendingOcularCancellation] = useState<{
  id: string;
  reference: string;
} | null>(null);

const [isCancellingOcular, setIsCancellingOcular] = useState(false);

const [ocularCancelError, setOcularCancelError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);

  const [ocularBookings, setOcularBookings] = useState<OcularRecord[]>([]);
  const [ocularEdit, setOcularEdit] = useState({ scheduledDate: "", timeSlotId: "" });
  const [now, setNow] = useState(() => Date.now());
  const [ocularEditError, setOcularEditError] = useState<string | null>(null);
  const [isSavingOcular, setIsSavingOcular] = useState(false);
  const [reservationServicesById, setReservationServicesById] = useState<Record<string, EditableReservationService[]>>({});
  const [ocularSlotsById, setOcularSlotsById] = useState<Record<string, OcularTimeSlotRow>>({});
  const [serviceEditMessage, setServiceEditMessage] = useState<string | null>(null);
  const [isSavingServices, setIsSavingServices] = useState(false);
  const [rescheduleFormError, setRescheduleFormError] = useState<string | null>(null);
  const [rescheduleMessage, setRescheduleMessage] = useState<string | null>(null);
  const [isSubmittingReschedule, setIsSubmittingReschedule] = useState(false);
  const rescheduleSubmitting = useRef(false);
  const [rescheduleCalendarMonth, setRescheduleCalendarMonth] = useState("");
  const [rescheduleForm, setRescheduleForm] = useState<RescheduleFormState>({
    checkIn: "",
  });
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedOcularId, setSelectedOcularId] = useState<string | null>(null);

  const selectedBooking = bookings.find((item) => item.id === selectedBookingId) ?? null;
  const selectedOcular = ocularBookings.find((item) => item.id === selectedOcularId) ?? null;
  const selectedReschedulePolicy = selectedBooking ? reschedulePolicy(selectedBooking.startDatetime, now) : null;
  const canRequestReschedule = !selectedBooking?.checkedInAt && selectedBooking?.status.toLowerCase() === "confirmed";
  const rescheduleAvailability = useGuestRescheduleAvailability(selectedBooking?.startDatetime ?? "", selectedBooking?.endDatetime ?? "",
    rescheduleCalendarMonth, rescheduleForm.checkIn,
    recordMode === "reschedule" && canRequestReschedule);
  const selectedRescheduleIssue = selectedBooking && rescheduleForm.checkIn ? rescheduleAvailability.dateIssue(rescheduleForm.checkIn) : null;
  const requestedSchedule = selectedBooking && rescheduleForm.checkIn && !selectedRescheduleIssue
    ? moveReservationToDate({ start_datetime: selectedBooking.startDatetime, end_datetime: selectedBooking.endDatetime }, rescheduleForm.checkIn) : null;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const saveOcularEdit = async () => {
    if (!selectedOcular || isSavingOcular) return;
    setOcularEditError(null);
    const selectedSlot = ocularSlotsById[ocularEdit.timeSlotId];
    if (!selectedSlot || !isOcularSlotStartAllowed(ocularEdit.scheduledDate, selectedSlot.start_time)) {
      setOcularEditError(BOOKING_LEAD_MESSAGE);
      return;
    }
    setIsSavingOcular(true);
    try {
      const response = await fetch("/api/ocular-visits/reschedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitId: selectedOcular.id, ...ocularEdit }),
      });
      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (!response.ok || !result?.success) {
        setOcularEditError(result?.message ?? "Could not update this ocular visit.");
        return;
      }
      const slot = ocularSlotsById[ocularEdit.timeSlotId];
      setOcularBookings((current) => current.map((visit) => visit.id === selectedOcular.id
        ? { ...visit, scheduledDate: ocularEdit.scheduledDate, timeSlotId: ocularEdit.timeSlotId,
            timeSlot: slot ? `${slot.start_time}-${slot.end_time}` : visit.timeSlot }
        : visit));
      setRecordMode("view");
      setOcularMessage(result.message ?? "Your ocular visit schedule has been updated.");
    } catch {
      setOcularEditError("Could not update this ocular visit.");
    } finally {
      setIsSavingOcular(false);
    }
  };
  const minRescheduleDate = getMinRescheduleDate(selectedBooking);

  const openPaymentPortal = (booking: BookingRecord) => {
    setBookingDraft({
      bookingMode: booking.bookingMode ?? "day",
      startDatetime: booking.startDatetime,
      endDatetime: booking.endDatetime,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      adultCount: booking.adultCount,
      childCount: booking.childCount,
      roomName: "Remaining Balance Payment",
      roomPrice: booking.remainingBalance,
      nights: 1,
      subtotal: booking.remainingBalance,
      tax: 0,
      total: booking.totalAmount,
      downPayment: downPaymentAmount(booking.totalAmount),
      paidAmount: booking.paidAmount,
      firstName: "",
      lastName: "",
      email: booking.email,
      phone: booking.phone,
      address: "",
      unitId: "balance-payment",
      services: [],
      specialRequests: "",
      reservationId: booking.id,
      reservationReference: booking.reference,
    });

    router.push("/booking/payment");
  };


  const handleCancelOcularVisit = async (visitId: string) => {
    try {
      setIsCancellingOcular(true);
      setOcularCancelError(null);

      const response = await fetch("/api/ocular-visits/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          visitId,
        }),
      });

      const result = (await response.json().catch(() => null)) as {
        success?: boolean;
        message?: string;
      } | null;

      if (!response.ok || !result?.success) {
        setOcularCancelError(
          result?.message ?? "Failed to cancel ocular visit."
        );
        return;
      }

      setOcularBookings((current) =>
        current.map((booking) =>
          booking.id === visitId
            ? {
                ...booking,
                status: "Cancelled",
              }
            : booking
        )
      );

      setPendingOcularCancellation(null);
      setOcularMessage("Your ocular visit has been cancelled.");
    } catch {
      setOcularCancelError("Failed to cancel ocular visit.");
    } finally {
      setIsCancellingOcular(false);
    }
  };



  const handleSubmitReschedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (rescheduleSubmitting.current) return;

    if (!selectedBooking) {
      setRescheduleFormError("Select a booking first.");
      return;
    }

    if (selectedBooking.checkedInAt || isClosedReservation(selectedBooking.status)) {
      setRescheduleFormError("This reservation can no longer be rescheduled.");
      return;
    }

    if (selectedBooking.status.toLowerCase() !== "confirmed") {
      setRescheduleFormError("Payment must be approved before this reservation can be rescheduled.");
      return;
    }

    if (!rescheduleForm.checkIn) {
      setRescheduleFormError("Please choose a valid reschedule date.");
      return;
    }
    const issue = rescheduleAvailability.dateIssue(rescheduleForm.checkIn);
    if (issue) { setRescheduleFormError(issue); return; }
    const moved = moveReservationToDate({ start_datetime: selectedBooking.startDatetime, end_datetime: selectedBooking.endDatetime }, rescheduleForm.checkIn);

    setRescheduleFormError(null);
    rescheduleSubmitting.current = true;
    setIsSubmittingReschedule(true);

    try {
      const response = await fetch("/api/reservations/reschedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId: selectedBooking.id,
          newStartDatetime: moved.startDatetime,
          newEndDatetime: moved.endDatetime,
        }),
      });

      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string; rescheduleFee?: number; rateAdjustment?: number; totalAdditional?: number } | null;

      if (!response.ok || !result?.success) {
        setRescheduleFormError(result?.message ?? "Failed to submit reschedule request.");
        if (response.status === 409) rescheduleAvailability.refresh();
        return;
      }

      bookingRevision.current++;
      setBookings((currentBookings) =>
        currentBookings.map((booking) =>
          booking.id === selectedBooking.id
            ? {
                ...booking,
                status: "Reschedule Requested",
              }
            : booking
        )
      );

      setRecordMode("view");
      setRescheduleFormError(null);
      setRescheduleMessage(`Request sent for review. If approved, the additional charge will be ${formatCurrency(Number(result.totalAdditional ?? 0))} (${formatCurrency(Number(result.rescheduleFee ?? 0))} notice fee + ${formatCurrency(Number(result.rateAdjustment ?? 0))} higher date rate).`);
    } catch {
      setRescheduleFormError("Failed to submit reschedule request.");
    } finally {
      rescheduleSubmitting.current = false;
      setIsSubmittingReschedule(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const fetchManageRecords = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);

        const supabase = createClient();
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          if (!isMounted) return;
          setFetchError("Please log in to view your records.");
          setBookings([]);
          setOcularBookings([]);
          setIsLoading(false);
          return;
        }

        const [guestResult, reservationsResult, ocularResult, ocularSlotsResult] = await Promise.all([
          supabase.from("guests").select("email, phone_number").eq("id", user.id).maybeSingle<GuestRow>(),
          supabase
            .from("reservations")
            .select("reservation_id, reference_number, start_datetime, end_datetime, booking_mode, adult_count, child_count, status, payment_deadline_at, cancellation_snapshot, checked_in_at, checked_out_at")
            .eq("guest_id", user.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("ocular_visits")
            .select("visit_id, reference_number, scheduled_date, time_slot_id, status, created_at")
            .eq("guest_id", user.id)
            .order("created_at", { ascending: false }),
          supabase.from("ocular_time_slots").select("slot_id, start_time, end_time").eq("is_active", true).order("start_time"),
        ]);

        if (reservationsResult.error || ocularResult.error || ocularSlotsResult.error) {
          throw reservationsResult.error || ocularResult.error || ocularSlotsResult.error;
        }

        const reservationRows = (reservationsResult.data as ReservationRow[] | null) ?? [];
        const reservationIds = reservationRows.map((row) => row.reservation_id);

        const [
          { data: transactionRows, error: transactionsError },
          { data: reservationServicesData, error: reservationServicesError },
        ] = await Promise.all([
          reservationIds.length
            ? supabase
                .from("transactions")
                .select("reservation_id, total_amount, paid_amount, balance")
                .in("reservation_id", reservationIds)
            : Promise.resolve({ data: [], error: null }),
          reservationIds.length
            ? supabase
                .from("reservation_services")
                .select("reservation_id, service_id, quantity, price_at_time, services(name)")
                .in("reservation_id", reservationIds)
            : Promise.resolve({ data: [], error: null }),
        ]);

        if (transactionsError) {
          throw transactionsError;
        }

        if (reservationServicesError) {
          throw reservationServicesError;
        }

        if (!isMounted) return;

        const guestData = guestResult.data;
        const transactionByReservationId = ((transactionRows as TransactionRow[] | null) ?? []).reduce<
          Record<string, { total: number; paid: number; balance: number }>
        >((accumulator, transaction) => {
          accumulator[transaction.reservation_id] = {
            total: Number(transaction.total_amount ?? 0),
            paid: Number(transaction.paid_amount ?? 0),
            balance: Number(transaction.balance ?? 0),
          };
          return accumulator;
        }, {});

        const mappedBookings: BookingRecord[] = reservationRows.map((reservation) => ({
          id: reservation.reservation_id,
          reference: reservation.reference_number,
          startDatetime: reservation.start_datetime,
          endDatetime: reservation.end_datetime,
          checkIn: toDateTimeLocal(reservation.start_datetime),
          checkOut: toDateTimeLocal(reservation.end_datetime),
          bookingMode: reservation.booking_mode,
          guests: Number(reservation.adult_count ?? 0) + Number(reservation.child_count ?? 0),
          adultCount: Number(reservation.adult_count ?? 0), childCount: Number(reservation.child_count ?? 0),
          totalAmount: transactionByReservationId[reservation.reservation_id]?.total ?? 0,
          paidAmount: transactionByReservationId[reservation.reservation_id]?.paid ?? 0,
          remainingBalance: transactionByReservationId[reservation.reservation_id]?.balance ?? 0,
          status: toTitleCase(reservation.status),
          cancellationOutcome: reservation.cancellation_snapshot?.outcome, checkedInAt: reservation.checked_in_at, checkedOutAt: reservation.checked_out_at,
          paymentDeadlineAt: reservation.payment_deadline_at,
          email: guestData?.email ?? user.email ?? "-",
          phone: guestData?.phone_number ?? "-",
        }));

        const nextReservationServicesById = ((reservationServicesData as ReservationServiceRow[] | null) ?? []).reduce<
          Record<string, EditableReservationService[]>
        >((accumulator, serviceRow) => {
          const name =
            (Array.isArray(serviceRow.services) ? serviceRow.services[0]?.name : serviceRow.services?.name) ??
            "Service";

          const existing = accumulator[serviceRow.reservation_id] ?? [];
          existing.push({
            serviceId: serviceRow.service_id,
            name,
            quantity: Number(serviceRow.quantity ?? 1),
            minQuantity: Number(serviceRow.quantity ?? 1),
            priceAtTime: Number(serviceRow.price_at_time ?? 0),
          });
          accumulator[serviceRow.reservation_id] = existing;
          return accumulator;
        }, {});

        const ocularSlotMap = ((ocularSlotsResult.data as OcularTimeSlotRow[] | null) ?? []).reduce<Record<string, OcularTimeSlotRow>>((map, slot) => {
          map[slot.slot_id] = slot;
          return map;
        }, {});

        const mappedOcularBookings: OcularRecord[] = ((ocularResult.data as OcularVisitRow[] | null) ?? []).map(
          (visit) => ({
            id: visit.visit_id,
            reference: visit.reference_number,
            scheduledDate: visit.scheduled_date,
            timeSlotId: visit.time_slot_id ?? "",
            timeSlot: visit.time_slot_id && ocularSlotMap[visit.time_slot_id]
              ? `${ocularSlotMap[visit.time_slot_id].start_time}-${ocularSlotMap[visit.time_slot_id].end_time}`
              : "-",
            status: toTitleCase(visit.status),
            notes: `Created ${formatDate(visit.created_at)}`,
          })
        );

        setBookings(mappedBookings);
        setOcularBookings(mappedOcularBookings);
        setReservationServicesById(nextReservationServicesById);
        setOcularSlotsById(
          ocularSlotMap
        );
      } catch {
        if (!isMounted) return;
        setFetchError("Failed to load your booking records.");
        setBookings([]);
        setOcularBookings([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchManageRecords();

    return () => {
      isMounted = false;
    };
  }, []);

  const bookingIds = bookings.map(booking => booking.id).sort().join(",");
  useEffect(() => {
    if (!bookingIds) return;
    const reservationIds = bookingIds.split(",");
    let active = true;
    let refreshing = false;

    const refreshTransactionSnapshots = async () => {
      if (refreshing) return;
      refreshing = true;
      const revision = bookingRevision.current;
      try {
        const supabase = createClient();
        const [billResult, reservationResult] = await Promise.all([
          supabase.from("transactions").select("reservation_id, total_amount, paid_amount, balance").in("reservation_id", reservationIds),
          supabase.from("reservations").select("reservation_id, reference_number, start_datetime, end_datetime, booking_mode, adult_count, child_count, status, payment_deadline_at, cancellation_snapshot, checked_in_at, checked_out_at").in("reservation_id", reservationIds),
        ]);
        if (!active || revision !== bookingRevision.current || billResult.error || reservationResult.error) return;
        const reservations = new Map(((reservationResult.data as ReservationRow[] | null) ?? []).map(row => [row.reservation_id, row]));
        const bills = new Map(((billResult.data as TransactionRow[] | null) ?? []).map(row => [row.reservation_id, row]));
        setBookings(current => current.map(booking => {
          const bill = bills.get(booking.id), reservation = reservations.get(booking.id);
          if (!bill || !reservation) return booking;
          return {
            ...booking,
            startDatetime: reservation.start_datetime, endDatetime: reservation.end_datetime,
            checkIn: toDateTimeLocal(reservation.start_datetime), checkOut: toDateTimeLocal(reservation.end_datetime),
            bookingMode: reservation.booking_mode, guests: reservation.adult_count + reservation.child_count,
            adultCount: reservation.adult_count, childCount: reservation.child_count,
            status: toTitleCase(reservation.status), paymentDeadlineAt: reservation.payment_deadline_at,
            cancellationOutcome: reservation.cancellation_snapshot?.outcome, checkedInAt: reservation.checked_in_at, checkedOutAt: reservation.checked_out_at,
            totalAmount: Number(bill.total_amount ?? 0), paidAmount: Number(bill.paid_amount ?? 0), remainingBalance: Number(bill.balance ?? 0),
          };
        }));
      } catch { /* Preserve the last loaded records after a temporary network failure. */ }
      finally { refreshing = false; }
    };

    const timer = window.setInterval(() => {
      void refreshTransactionSnapshots();
    }, 20000);
    window.addEventListener("focus", refreshTransactionSnapshots);

    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshTransactionSnapshots);
    };
  }, [bookingIds]);


  const dialogBusy = isSavingServices || isSubmittingReschedule || isSavingOcular;
  const closeRecord = () => {
    if (dialogBusy) return;
    setRecordMode(null); setSelectedBookingId(null); setSelectedOcularId(null);
  };
  const openBookingRecord = (record: BookingRecord, mode: Exclude<RecordMode, null>) => {
    setSelectedBookingId(record.id); setSelectedOcularId(null); setRecordMode(mode);
    setServiceEditMessage(null); setRescheduleFormError(null); setRescheduleMessage(null);
    if (mode === "reschedule") {
      setRescheduleForm({ checkIn: "" });
      const minimum = getMinRescheduleDate(record);
      setRescheduleCalendarMonth((manilaDateKey(record.startDatetime) < minimum ? minimum : manilaDateKey(record.startDatetime)).slice(0, 7));
    }
  };
  const openOcularRecord = (record: OcularRecord, mode: "view" | "edit") => {
    setSelectedOcularId(record.id); setSelectedBookingId(null); setRecordMode(mode); setOcularEditError(null); setOcularMessage(null);
    setOcularEdit({ scheduledDate: record.scheduledDate, timeSlotId: record.timeSlotId });
  };
  const statusStyle = (status: string) => {
    const normalized = status.toLowerCase();
    return normalized === "confirmed" || normalized === "completed" ? "bg-secondary/10 text-teal-800"
      : isClosedReservation(status) ? "bg-neutral/5 text-neutral/60" : "bg-amber-50 text-amber-800";
  };
  const bookingStatus = (record: BookingRecord) => record.cancellationOutcome === "no_refund" ? "Cancelled - No Refund" : record.status;
  const visibleBookings = bookings.filter(record => record.reference.toLowerCase().includes(search.trim().toLowerCase()));
  const visibleOcular = ocularBookings.filter(record => record.reference.toLowerCase().includes(search.trim().toLowerCase()));
  const currentRecord = activeTab === "bookings" ? selectedBooking : activeTab === "ocular" ? selectedOcular : null;
  const showRefunds = (reference: string) => {
    closeRecord(); setActiveTab("refunds"); setSearch(reference);
    window.requestAnimationFrame(() => {
      refundsTab.current?.focus({ preventScroll: true });
      recordsPanel.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    });
  };

  return (
    <div className="min-h-screen bg-base">
      <Navigation />
      <section className="relative mt-20 flex h-56 items-center justify-center overflow-hidden sm:h-64">
        <Image src="/website_cover.jpg" alt="Marville Resort" fill className="object-cover" priority />
        <div className="absolute inset-0 bg-neutral/55" />
        <div className="relative z-10 px-5 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/75">Your Marville stay</p>
          <h1 className="text-3xl font-bold text-white sm:text-5xl">Manage Booking</h1>
          <p className="mt-3 max-w-xl text-sm text-white/85 sm:text-black">Your schedules, payments and requests, all in one place.</p>
        </div>
      </section>

      <main className="relative mx-auto max-w-6xl px-3 pb-16 pt-6 sm:px-6 sm:pt-8">
        <div ref={recordsPanel} className="scroll-mt-24 rounded-3xl border border-neutral/10 bg-white p-4 shadow-sm sm:p-7">
          <div className="flex flex-col justify-between gap-4 border-b border-neutral/10 pb-5 md:flex-row md:items-center">
            <div className="grid grid-cols-3 gap-1 rounded-2xl bg-base p-1 md:flex" role="group" aria-label="Record type">
              {(["bookings", "ocular", "refunds"] as const).map(tab => <button key={tab} ref={tab === "refunds" ? refundsTab : undefined} type="button" aria-pressed={activeTab === tab}
                onClick={() => { closeRecord(); setActiveTab(tab); setSearch(""); }}
                className={`flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-3 text-xs font-semibold transition sm:px-3 sm:text-sm ${activeTab === tab ? "bg-white text-primary shadow-sm" : "text-neutral/60 hover:text-neutral"}`}>
                <ManageIcon name={tab === "bookings" ? "calendar" : tab === "ocular" ? "view" : "wallet"} className="hidden h-4 w-4 shrink-0 sm:block" />
                {tab === "bookings" ? "Bookings" : tab === "ocular" ? "Ocular visits" : "Refunds"}
                {tab !== "refunds" && <span className="hidden rounded-full bg-neutral/5 px-2 py-0.5 text-xs sm:inline">{tab === "bookings" ? bookings.length : ocularBookings.length}</span>}
              </button>)}
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-neutral/15 px-3 py-2.5 md:w-56">
              <ManageIcon name="search" className="h-4 w-4 text-neutral/45" />
              <input type="search" aria-label="Search booking reference" value={search} onChange={event => setSearch(event.target.value)}
                placeholder="Search reference" className="min-w-0 w-full bg-transparent text-black text-neutral outline-none sm:text-sm" />
            </label>
          </div>
          <div className="mb-5 mt-5 flex items-start justify-between gap-3">
            <div><h2 className="text-xl font-semibold text-neutral">{activeTab === "bookings" ? "Your reservations" : activeTab === "ocular" ? "Your ocular visits" : "Your refunds"}</h2>
              <p className="mt-1 text-sm text-neutral/60">{activeTab === "refunds" ? "Track refund progress and request eligible excess-payment refunds here." : "Open the three-dot options menu to view details or make changes."}</p></div>
            <span className="hidden shrink-0 rounded-full bg-base px-3 py-2 text-xs text-neutral/55 sm:inline-flex">Philippine time</span>
          </div>
          {fetchError && activeTab !== "refunds" && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{fetchError}</p>}
          {activeTab === "bookings" && <>
            {cancellationMessage && <p role="status" className="mb-4 rounded-xl bg-secondary/10 p-4 text-sm text-teal-900">{cancellationMessage}</p>}
            {cancelError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{cancelError}</p>}
          </>}
          {activeTab === "ocular" && <>
            {ocularMessage && !recordMode && <p role="status" className="mb-4 rounded-xl bg-secondary/10 p-4 text-sm text-teal-900">{ocularMessage}</p>}
            {ocularCancelError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{ocularCancelError}</p>}
          </>}
          {activeTab !== "refunds" && (isLoading ? <div role="status" className="rounded-2xl bg-base p-8 text-center text-sm text-neutral/60">Loading your records...</div>
            : ((activeTab === "bookings" ? visibleBookings : visibleOcular).length === 0) ?
              <div className="rounded-2xl border border-dashed border-neutral/15 bg-base/50 p-10 text-center">
                <ManageIcon name="calendar" className="mx-auto mb-3 h-8 w-8 text-neutral/35" />
                <p className="font-semibold text-neutral">{search ? "No matching references" : activeTab === "bookings" ? "No reservations yet" : "No ocular visits yet"}</p>
                <p className="mt-2 text-sm text-neutral/60">{search ? "Try another reference or clear your search." : "Your saved records will appear here."}</p>
              </div>
            : <div className="space-y-4">
              {activeTab === "bookings" && visibleBookings.map(record => {
                const closed = isClosedReservation(record.status), reviewing = record.status.toLowerCase() === "payment submitted";
                return <article key={record.id} aria-label={`Booking ${record.reference}`} className="overflow-hidden rounded-2xl border border-neutral/10 transition hover:border-primary/25 hover:shadow-sm">
                  <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
                    <div className="min-w-0"><p className="break-all text-black font-semibold text-neutral">{record.reference}</p>
                      <p className="mt-1 flex items-center gap-2 text-xs text-neutral/60"><span className="capitalize">{record.bookingMode?.replace(/_/g, " ") || "Reservation"}</span><span aria-hidden="true">&middot;</span><ManageIcon name="guests" className="h-4 w-4" />{record.guests} guests</p>
                      <span className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-medium ${statusStyle(record.status)}`}>{bookingStatus(record)}</span>
                    </div>
                    <RecordActionsMenu reference={record.reference} actions={[
                      { label: "View", icon: "view", explanation: "Details, payment and refund updates", onSelect: () => openBookingRecord(record, "view") },
                      { label: "Edit booking", icon: "edit", disabled: closed || reviewing, explanation: closed ? "This reservation is closed" : reviewing ? "Available after payment review" : "Update guest counts, services and billing", onSelect: () => openBookingRecord(record, "edit") },
                      { label: "Reschedule", icon: "calendar", disabled: Boolean(record.checkedInAt) || record.status.toLowerCase() !== "confirmed", explanation: record.checkedInAt ? "Rescheduling is locked after check-in" : record.status.toLowerCase() === "confirmed" ? "Request a new date for staff approval" : "Available for confirmed reservations", onSelect: () => openBookingRecord(record, "reschedule") },
                      { label: "Pay balance", icon: "wallet", disabled: closed || reviewing || record.remainingBalance <= 0, explanation: closed ? "This reservation is closed" : reviewing ? "Your payment is being reviewed" : record.remainingBalance <= 0 ? "No outstanding balance" : "Continue to GCash payment", onSelect: () => openPaymentPortal(record) },
                      { label: "Cancel reservation", icon: "cancel", danger: true, disabled: closed || Boolean(record.checkedInAt), explanation: record.checkedInAt ? "Cancellation is locked after check-in" : closed ? "This reservation is closed" : "Review the refund calculation first", onSelect: () => { setCancelError(null); setPendingCancellation({ id: record.id, reference: record.reference, checkIn: record.checkIn }); } },
                    ]} />
                  </div>
                  <div className="grid min-w-0 gap-4 border-t border-neutral/5 px-4 py-4 [overflow-wrap:anywhere] sm:grid-cols-2 sm:px-5 lg:grid-cols-4">
                    <div><p className="mb-1 text-xs text-neutral/55">Check-in</p><p className="text-sm font-medium text-neutral">{formatDateTime(record.startDatetime)}</p></div>
                    <div><p className="mb-1 text-xs text-neutral/55">Check-out</p><p className="text-sm font-medium text-neutral">{formatDateTime(record.endDatetime)}</p></div>
                    <div><p className="mb-1 text-xs text-neutral/55">Reservation total</p><p className="text-sm font-semibold text-neutral">{formatCurrency(record.totalAmount)}</p><p className="mt-1 text-xs text-neutral/55">Net paid {formatCurrency(record.paidAmount)}</p></div>
                    <div><p className="mb-1 text-xs text-neutral/55">{record.status.toLowerCase() === "cancelled" ? "Payment collection" : "Remaining balance"}</p>
                      <p className="text-sm font-semibold text-primary">{record.status.toLowerCase() === "cancelled" ? "Closed" : formatCurrency(record.remainingBalance)}</p>
                      {record.cancellationOutcome === "pending_refund" && <button type="button" onClick={() => showRefunds(record.reference)} className="mt-1 text-xs text-primary underline">View refund updates</button>}
                      {record.status.toLowerCase() === "pending" && record.paymentDeadlineAt && <p className="mt-1 text-xs text-amber-800">Payment due {formatDateTime(record.paymentDeadlineAt)}</p>}
                    </div>
                  </div>
                </article>;
              })}
              {activeTab === "ocular" && visibleOcular.map(record => {
                const closed = isClosedReservation(record.status);
                return <article key={record.id} aria-label={`Ocular visit ${record.reference}`} className="rounded-2xl border border-neutral/10 p-4 transition hover:border-primary/25 hover:shadow-sm sm:p-5">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-all font-semibold text-neutral">{record.reference}</p><span className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${statusStyle(record.status)}`}>{record.status}</span></div>
                    <RecordActionsMenu reference={record.reference} actions={[
                      { label: "View", icon: "view", explanation: "Visit schedule and status", onSelect: () => openOcularRecord(record, "view") },
                      { label: "Edit visit", icon: "edit", disabled: closed, explanation: closed ? "This visit is closed" : "Change the date or time slot", onSelect: () => openOcularRecord(record, "edit") },
                      { label: "Cancel visit", icon: "cancel", danger: true, disabled: closed, explanation: closed ? "This visit is closed" : "Cancel your scheduled resort visit", onSelect: () => { setOcularCancelError(null); setOcularMessage(null); setPendingOcularCancellation({ id: record.id, reference: record.reference }); } },
                    ]} />
                  </div>
                  <div className="mt-4 grid gap-3 border-t border-neutral/5 pt-4 text-sm sm:grid-cols-3">
                    <div><p className="mb-1 text-xs text-neutral/55">Scheduled date</p><p className="font-medium">{formatDate(record.scheduledDate)}</p></div>
                    <div><p className="mb-1 text-xs text-neutral/55">Time slot</p><p className="font-medium">{formatTimeSlot(record.timeSlot)}</p></div>
                    <div><p className="mb-1 text-xs text-neutral/55">Record note</p><p className="text-neutral/65">{record.notes}</p></div>
                  </div>
                </article>;
              })}
            </div>)}
          {activeTab === "refunds" && <GuestRefundStatus refreshKey={refundRefresh} referenceSearch={search} standalone />}
        </div>
      </main>

      {recordMode && currentRecord && <RecordDialog reference={currentRecord.reference} busy={dialogBusy} onClose={closeRecord}
        title={activeTab === "ocular" ? recordMode === "view" ? "Ocular visit details" : "Edit ocular visit" : recordMode === "view" ? "Booking details" : recordMode === "edit" ? "Edit booking" : "Reschedule booking"}>
        {activeTab === "bookings" && <>
          {recordMode === "view" && selectedBooking && <div className="space-y-5">
            {serviceEditMessage && <p role="status" className="rounded-xl bg-secondary/10 p-4 text-sm text-teal-900">{serviceEditMessage}</p>}
            {rescheduleMessage && <p role="status" className="rounded-xl bg-secondary/10 p-4 text-sm text-teal-900">{rescheduleMessage}</p>}
            {selectedBooking.cancellationOutcome === "no_refund" && <p className="rounded-xl bg-base p-4 text-sm text-neutral/70">This reservation is cancelled. No refundable payment remains under the cancellation policy.</p>}
            {selectedBooking.cancellationOutcome === "pending_refund" && <p className="rounded-xl bg-secondary/10 p-4 text-sm text-teal-900">This reservation is cancelled. Your refund request was created automatically. Follow its progress in the Refunds tab.</p>}
            <div className="flex flex-wrap items-center justify-between gap-3"><span className={`rounded-full px-3 py-1 text-sm font-medium ${statusStyle(selectedBooking.status)}`}>{bookingStatus(selectedBooking)}</span><span className="flex items-center gap-2 text-sm text-neutral/65"><ManageIcon name="guests" />{selectedBooking.guests} guests</span></div>
            {selectedBooking.status.toLowerCase() === "pending" && selectedBooking.paymentDeadlineAt && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Submit payment by {formatDateTime(selectedBooking.paymentDeadlineAt)}.</p>}
            <dl className="grid gap-4 rounded-2xl bg-base p-5 text-sm sm:grid-cols-2">
              <div><dt className="text-neutral/55">Check-in</dt><dd className="mt-1 font-semibold">{formatDateTime(selectedBooking.startDatetime)}</dd></div>
              <div><dt className="text-neutral/55">Check-out</dt><dd className="mt-1 font-semibold">{formatDateTime(selectedBooking.endDatetime)}</dd></div>
              <div><dt className="text-neutral/55">Package</dt><dd className="mt-1 font-medium capitalize">{selectedBooking.bookingMode?.replace(/_/g, " ") || "Reservation"}</dd></div>
              <div><dt className="text-neutral/55">Contact email</dt><dd className="mt-1 break-all font-medium">{selectedBooking.email}</dd></div>
            </dl>
            <div className="grid gap-3 rounded-2xl border border-neutral/10 p-5 text-sm sm:grid-cols-3">
              <div><p className="text-neutral/55">Reservation total</p><p className="mt-1 text-lg font-semibold">{formatCurrency(selectedBooking.totalAmount)}</p></div>
              <div><p className="text-neutral/55">Net verified paid</p><p className="mt-1 text-lg font-semibold">{formatCurrency(selectedBooking.paidAmount)}</p></div>
              <div><p className="text-neutral/55">{selectedBooking.status.toLowerCase() === "cancelled" ? "Payment collection" : "Remaining balance"}</p><p className="mt-1 text-lg font-semibold text-primary">{selectedBooking.status.toLowerCase() === "cancelled" ? "Closed" : formatCurrency(selectedBooking.remainingBalance)}</p></div>
            </div>
            <div><h3 className="mb-3 font-semibold">Booked services</h3>
              {(reservationServicesById[selectedBooking.id] ?? []).length === 0 ? <p className="text-sm text-neutral/60">No services selected.</p>
                : <div className="divide-y divide-neutral/10 rounded-xl border border-neutral/10 px-4">{(reservationServicesById[selectedBooking.id] ?? []).map(service => <div key={service.serviceId} className="flex justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="font-medium">{service.name} &times; {service.quantity}</p><p className="mt-1 text-xs text-neutral/55">{formatCurrency(service.priceAtTime)} each</p></div><p className="shrink-0 font-medium">{formatCurrency(service.priceAtTime * service.quantity)}</p></div>)}</div>}
            </div>
            {selectedBooking.remainingBalance > 0 && !isClosedReservation(selectedBooking.status) && selectedBooking.status.toLowerCase() !== "payment submitted" && <div className="rounded-2xl bg-primary/5 p-5">
              <h3 className="font-semibold">Continue payment</h3><p className="mt-1 text-sm text-neutral/65">Submit your GCash receipt for the outstanding balance.</p>
              <button type="button" onClick={() => openPaymentPortal(selectedBooking)} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl sm:w-auto bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary/90">Continue to Payment<ManageIcon name="arrow" className="h-4 w-4" /></button>
            </div>}
            {!["payment submitted", "reschedule requested"].includes(selectedBooking.status.toLowerCase()) && !isClosedReservation(selectedBooking.status) && <div className="flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => openBookingRecord(selectedBooking, "edit")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary/25 px-5 py-3 text-sm font-semibold text-primary hover:bg-primary/5"><ManageIcon name="edit" />Edit booking</button>
              {!selectedBooking.checkedInAt && selectedBooking.status.toLowerCase() === "confirmed" && <button type="button" onClick={() => openBookingRecord(selectedBooking, "reschedule")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-neutral/15 px-5 py-3 text-sm font-semibold text-neutral"><ManageIcon name="calendar" />Reschedule</button>}
              {!selectedBooking.checkedInAt && <button type="button" onClick={() => { setRecordMode(null); setPendingCancellation({ id: selectedBooking.id, reference: selectedBooking.reference, checkIn: selectedBooking.checkIn }); }} className="min-h-11 rounded-xl border border-red-200 px-5 py-3 text-sm font-semibold text-red-700">Cancel reservation</button>}
            </div>}
            {selectedBooking.checkedInAt && <p className="rounded-xl bg-base p-3 text-sm text-neutral/70">{selectedBooking.checkedOutAt ? "Your stay is completed. You can share your experience on the Reviews page." : "You are checked in. Cancellation and rescheduling are no longer available."}</p>}
            <button type="button" onClick={() => showRefunds(selectedBooking.reference)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-neutral/10 px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/5"><span className="flex items-center gap-2"><ManageIcon name="wallet" />View refunds</span><ManageIcon name="arrow" /></button>
          </div>}
          {recordMode === "edit" && selectedBooking && <GuestBookingEditor key={selectedBooking.id} reservationId={selectedBooking.id} onBusyChange={setIsSavingServices}
            onSaved={result => {
              bookingRevision.current++;
              setReservationServicesById(current => ({ ...current, [selectedBooking.id]: result.services.map(service => ({ ...service, minQuantity: 1 })) }));
              setBookings(current => current.map(booking => booking.id === selectedBooking.id ? { ...booking, guests: result.adultCount + result.childCount, adultCount: result.adultCount, childCount: result.childCount,
                totalAmount: result.totalAmount, paidAmount: result.paidAmount, remainingBalance: result.remainingBalance } : booking));
              setServiceEditMessage(result.message); setRecordMode("view"); setRefundRefresh(value => value + 1);
            }} />}

          {recordMode === "reschedule" && selectedBooking && (
            <form
              className="min-w-0 rounded-2xl border border-neutral/10 bg-base p-3 space-y-4 sm:p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void handleSubmitReschedule(event);
              }}
            >
              <h3 className="text-lg font-semibold text-neutral">Reschedule Booking</h3>

              <div className="rounded-lg bg-neutral/5 p-4 space-y-2 text-sm">
                <p><span className="text-neutral/70">Booking Mode:</span> <span className="font-semibold text-neutral capitalize">{selectedBooking.bookingMode?.replace(/_/g, " ") || "Unknown"}</span></p>
                <p><span className="text-neutral/70">Current Check-in:</span> <span className="font-semibold text-neutral">{formatDate(selectedBooking.startDatetime)}</span></p>
                <p><span className="text-neutral/70">Current Check-out:</span> <span className="font-semibold text-neutral">{formatDate(selectedBooking.endDatetime)}</span></p>
                {selectedBooking.startDatetime && selectedBooking.endDatetime && (
                  <>
                    <p><span className="text-neutral/70">Start Time:</span> <span className="font-semibold text-neutral">{new Date(selectedBooking.startDatetime).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" })}</span></p>
                    <p><span className="text-neutral/70">End Time:</span> <span className="font-semibold text-neutral">{new Date(selectedBooking.endDatetime).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit" })}</span></p>
                  </>
                )}
              </div>

              <div className="rounded-xl border border-neutral/10 bg-white p-3 text-sm text-neutral">
                <p>{RESCHEDULE_POLICY_TEXT}</p><p className="mt-2">{RESCHEDULE_FEE_TEXT}</p>
                <p className="mt-2 font-medium">Notice fee for this booking: {formatCurrency(selectedReschedulePolicy?.noticeFee ?? 0)}.</p>
                {canRequestReschedule && !selectedReschedulePolicy?.allowed && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">This request is within the usual {selectedReschedulePolicy?.minimumNoticeDays}-day notice period. You can submit it for staff approval. The applicable notice fee and any higher date rate will be added only if approved; your current schedule remains unchanged until then.</p>}
              </div>
              {!canRequestReschedule && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
                <p className="font-semibold">Rescheduling unavailable</p>
                <p className="mt-1">{selectedBooking.checkedInAt ? "Rescheduling is locked after check-in."
                  : `This reservation is now ${selectedBooking.status.toLowerCase()}. Only confirmed reservations can request a new date.`}</p>
              </div>}
              <RescheduleCalendar
                disabled={!canRequestReschedule || isSubmittingReschedule}
                disabledReason={selectedBooking.checkedInAt ? "Rescheduling is locked after check-in" : isSubmittingReschedule ? "Submitting your reschedule request" : "Only confirmed reservations can be rescheduled"}
                value={rescheduleForm.checkIn}
                onChange={date => { setRescheduleForm({ checkIn: date }); setRescheduleFormError(null); }}
                minDate={minRescheduleDate}
                originalDate={manilaDateKey(selectedBooking.startDatetime)}
                onMonthChange={setRescheduleCalendarMonth}
                month={rescheduleCalendarMonth}
                loading={canRequestReschedule && !rescheduleAvailability.ready && !rescheduleAvailability.error}
                getUnavailableReason={rescheduleAvailability.calendarDateIssue}
                error={rescheduleAvailability.error}
                onRetry={rescheduleAvailability.refresh}
              />
              {rescheduleForm.checkIn && <p role="status" className="rounded-lg bg-white p-3 text-sm text-neutral">
                {selectedRescheduleIssue ?? (requestedSchedule && `Requested schedule: ${formatDateTime(requestedSchedule.startDatetime)} to ${formatDateTime(requestedSchedule.endDatetime)}.`)}
              </p>}
              <p className="text-xs text-neutral/60">An additional notice fee and any higher date rate are charged after approval.</p>
              {rescheduleFormError && <p role="alert" className="rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">{rescheduleFormError}</p>}
              <button
                type="submit"
                disabled={isSubmittingReschedule || !canRequestReschedule || !rescheduleForm.checkIn || Boolean(selectedRescheduleIssue)}
                className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold sm:w-auto sm:rounded-full sm:px-6 text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmittingReschedule ? "Submitting Request..." : "Submit Reschedule Request"}
              </button>
            </form>
          )}


        </>}
        {activeTab === "ocular" && <>
          {ocularMessage && <p role="status" className="mb-4 rounded-xl bg-secondary/10 p-4 text-sm text-teal-900">{ocularMessage}</p>}
          {recordMode === "view" && selectedOcular && (
            <div className="rounded-2xl border border-neutral/10 bg-base p-5">
              <h3 className="text-lg font-semibold text-neutral mb-3">Ocular Visit Details</h3>
              <div className="grid gap-3 md:grid-cols-2 text-sm text-neutral/80">
                <p>
                  Reference: <span className="font-semibold text-neutral">{selectedOcular.reference}</span>
                </p>
                <p>
                  Scheduled Date: <span className="font-semibold text-neutral">{formatDate(selectedOcular.scheduledDate)}</span>
                </p>
                <p>
                  Time Slot: <span className="font-semibold text-neutral">{formatTimeSlot(selectedOcular.timeSlot)}</span>
                </p>
                <p>
                  Status: <span className="font-semibold text-neutral">{selectedOcular.status}</span>
                </p>
                <p>
                  Notes: <span className="font-semibold text-neutral">{selectedOcular.notes}</span>
                </p>
              </div>
            </div>
          )}

          {recordMode === "edit" && selectedOcular && (
            <form
              className="min-w-0 rounded-2xl border border-neutral/10 bg-base p-3 space-y-4 sm:p-5"
              onSubmit={(event) => {
                event.preventDefault();
                void saveOcularEdit();
              }}
            >
              <h3 className="text-lg font-semibold text-neutral">Edit Ocular Visit</h3>
              {ocularEditError && <p role="alert" className="text-sm text-red-700">{ocularEditError}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Scheduled Date</label>
                  <input
                    type="date"
                    required
                    min={manilaDateKey(new Date(now))}
                    aria-label="Scheduled Date"
                    value={ocularEdit.scheduledDate}
                    className="min-h-11 min-w-0 w-full rounded-lg border border-neutral/20 px-3 py-2 text-black"
                    onChange={(event) => setOcularEdit((current) => ({ ...current, scheduledDate: event.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm text-neutral/70">Time Slot</label>
                  <select
                    required
                    aria-label="Time Slot"
                    value={ocularEdit.timeSlotId}
                    onChange={(event) => setOcularEdit((current) => ({ ...current, timeSlotId: event.target.value }))}
                    className="min-h-11 min-w-0 w-full rounded-lg border border-neutral/20 px-3 py-2 text-black"
                  >
                    {Object.values(ocularSlotsById).map((slot) => {
                      const slotValue = `${slot.start_time}-${slot.end_time}`;
                      return <option key={slot.slot_id} value={slot.slot_id} disabled={!isOcularSlotStartAllowed(ocularEdit.scheduledDate, slot.start_time, now)}>{formatTimeSlot(slotValue)}</option>;
                    })}
                  </select>
                  <p className="mt-1 text-xs text-neutral/60">Manila time. Slots starting in less than 30 minutes are unavailable.</p>
                </div>
              </div>
              <button type="submit" disabled={isSavingOcular} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold sm:w-auto sm:rounded-full sm:px-6 sm:text-black text-white hover:bg-primary/90 disabled:opacity-50">
                {isSavingOcular ? "Saving..." : "Save Changes"}
              </button>
            </form>
          )}

        </>}
      </RecordDialog>}

      {pendingCancellation && <CancellationDialog reservationId={pendingCancellation.id} onClose={() => setPendingCancellation(null)}
        rescheduleBlockedReason={(() => { const booking = bookings.find(row => row.id === pendingCancellation.id); return booking?.checkedInAt ? "Rescheduling is locked after check-in." : !booking || booking.status.toLowerCase() !== "confirmed" ? "Only confirmed reservations can request a new date." : null; })()}
        rescheduleNotice={(() => { const booking = bookings.find(row => row.id === pendingCancellation.id); return booking?.status.toLowerCase() === "confirmed" && !booking.checkedInAt && !reschedulePolicy(booking.startDatetime, now).allowed ? "You can request a new date even with short notice. Staff approval is required, and the applicable notice fee is charged only after approval." : null; })()}
        onReschedule={() => { const booking = bookings.find(row => row.id === pendingCancellation.id); if (booking) { setPendingCancellation(null); openBookingRecord(booking, "reschedule"); } }} onCancelled={result => {
        bookingRevision.current++;
        const id = pendingCancellation.id;
        setServiceEditMessage(null); setRescheduleMessage(null);
        setBookings(current => current.map(item => item.id === id ? { ...item, status: "Cancelled", cancellationOutcome: result.outcome } : item));
        setCancellationMessage(result.message); setPendingCancellation(null); setSelectedBookingId(id); setSelectedOcularId(null); setRecordMode("view"); setRefundRefresh(n => n + 1);
      }} />}
      <ConfirmationDialog isOpen={Boolean(pendingOcularCancellation)} title="Cancel Ocular Visit"
        message={ocularCancelError ?? `Cancel ocular visit ${pendingOcularCancellation?.reference ?? ""}?`} confirmText="Confirm Cancel" cancelText="Keep Visit"
        isConfirming={isCancellingOcular} onCancel={() => { if (!isCancellingOcular) setPendingOcularCancellation(null); }}
        onConfirm={() => { if (pendingOcularCancellation) void handleCancelOcularVisit(pendingOcularCancellation.id); }} />
      <Footer />
    </div>
  );
}
