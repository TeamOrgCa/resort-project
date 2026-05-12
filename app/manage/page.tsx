"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import ConfirmationDialog from "@/components/ui/ConfirmationDialog";
import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";

type ManageTab = "bookings" | "ocular";
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
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  status: string;
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
  time_slot: string;
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

interface ServiceCatalogRow {
  service_id: string;
  name: string;
  price: number;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatDateTime = (value: string) => {

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-PH", {
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

const parseDateValue = (value: string) => {
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toDateOnly = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toLocalDateInputValue = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let earliest = new Date(today);

  if (booking?.startDatetime) {
    const originalStart = new Date(booking.startDatetime);
    if (!Number.isNaN(originalStart.getTime())) {
      const candidate = new Date();
      candidate.setHours(
        originalStart.getHours(),
        originalStart.getMinutes(),
        originalStart.getSeconds(),
        0
      );

      if (candidate.getTime() <= Date.now()) {
        earliest.setDate(earliest.getDate() + 1);
      }
    }
  }

  if (booking?.checkIn) {
    const bookingDateValue = toDateOnly(booking.checkIn);
    const bookingDate = parseDateValue(bookingDateValue);
    if (bookingDate && bookingDate.getTime() > earliest.getTime()) {
      earliest = bookingDate;
    }
  }

  return toLocalDateInputValue(earliest);
};

const withOriginalTime = (nextDate: string, sourceDateTime: string) => {
  const source = new Date(sourceDateTime);
  if (Number.isNaN(source.getTime())) {
    return `${nextDate}T08:00:00`;
  }

  const hours = `${source.getHours()}`.padStart(2, "0");
  const minutes = `${source.getMinutes()}`.padStart(2, "0");
  const seconds = `${source.getSeconds()}`.padStart(2, "0");
  return `${nextDate}T${hours}:${minutes}:${seconds}`;
};

const isAtLeastTwoDaysAway = (checkInValue: string) => {
  const checkInDate = parseDateValue(checkInValue);
  if (!checkInDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = (checkInDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000);
  return diffDays >= 2;
};

export default function ManageBooking() {
  const router = useRouter();
  const setBookingDraft = useBookingStore((state) => state.setBookingDraft);
  const [activeTab, setActiveTab] = useState<ManageTab>("bookings");
  const [recordMode, setRecordMode] = useState<RecordMode>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancellingBooking, setIsCancellingBooking] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState<{ id: string; reference: string; checkIn: string } | null>(null);
  const [pendingOcularCancellation, setPendingOcularCancellation] = useState<{
  id: string;
  reference: string;
} | null>(null);

const [isCancellingOcular, setIsCancellingOcular] = useState(false);

const [ocularCancelError, setOcularCancelError] = useState<string | null>(null);
  const [bookings, setBookings] = useState<BookingRecord[]>([]);

  const [ocularBookings, setOcularBookings] = useState<OcularRecord[]>([]);
  const [reservationServicesById, setReservationServicesById] = useState<Record<string, EditableReservationService[]>>({});
  const [availableServices, setAvailableServices] = useState<ServiceCatalogRow[]>([]);
  const [editableServices, setEditableServices] = useState<EditableReservationService[]>([]);
  const [selectedAddServiceId, setSelectedAddServiceId] = useState("");
  const [addServiceQuantity, setAddServiceQuantity] = useState("1");
  const [serviceEditError, setServiceEditError] = useState<string | null>(null);
  const [isSavingServices, setIsSavingServices] = useState(false);
  const [rescheduleFormError, setRescheduleFormError] = useState<string | null>(null);
  const [isSubmittingReschedule, setIsSubmittingReschedule] = useState(false);
  const [rescheduleForm, setRescheduleForm] = useState<RescheduleFormState>({
    checkIn: "",
  });
  const [remainingPaymentMethod, setRemainingPaymentMethod] = useState<"bank" | "ewallet">("bank");
  const [remainingPaymentError, setRemainingPaymentError] = useState<string | null>(null);
  const [remainingPaymentSuccess, setRemainingPaymentSuccess] = useState<string | null>(null);
  const [isSubmittingRemainingPayment, setIsSubmittingRemainingPayment] = useState(false);

  const [remainingBankDetails, setRemainingBankDetails] = useState({
    accountName: "",
    referenceNumber: "",
    uploadProof: null as File | null,
  });

  const [remainingEwalletDetails, setRemainingEwalletDetails] = useState({
    accountName: "",
    accountNumber: "",
    referenceNumber: "",
    uploadProof: null as File | null,
  });

  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedOcularId, setSelectedOcularId] = useState<string | null>(null);

  const selectedBooking = bookings.find((item) => item.id === selectedBookingId) ?? null;
  const selectedOcular = ocularBookings.find((item) => item.id === selectedOcularId) ?? null;
  const minRescheduleDate = getMinRescheduleDate(selectedBooking);

  const getDaysBeforeCheckIn = (checkInDate: string) => {
    const checkIn = new Date(`${checkInDate}T00:00:00`);
    if (Number.isNaN(checkIn.getTime())) return 0;

    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    return (checkIn.getTime() - now.getTime()) / dayMs;
  };

  const openPaymentPortal = (booking: BookingRecord) => {
    setBookingDraft({
      bookingMode: "custom",
      startDatetime: booking.startDatetime,
      endDatetime: booking.endDatetime,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      adultCount: booking.guests,
      childCount: 0,
      roomName: "Remaining Balance Payment",
      roomPrice: booking.remainingBalance,
      nights: 1,
      subtotal: booking.remainingBalance,
      tax: 0,
      total: booking.remainingBalance,
      downPayment: booking.remainingBalance,
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
    } catch {
      setOcularCancelError("Failed to cancel ocular visit.");
    } finally {
      setIsCancellingOcular(false);
    }
  };



  const handleCancelReservation = async (reservationId: string) => {
    const bookingToCancel = bookings.find((item) => item.id === reservationId);

    if (!bookingToCancel) {
      setCancelError("No booking selected for cancellation.");
      return;
    }

    setCancelError(null);
    setIsCancellingBooking(true);

    try {
      const response = await fetch("/api/reservations/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId,
          acceptedNoRefundPolicy: true,
        }),
      });

      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string } | null;

      if (!response.ok || !result?.success) {
        setCancelError(result?.message ?? "Failed to cancel booking.");
        return;
      }

      setBookings((prev) =>
        prev.map((item) =>
          item.id === reservationId
            ? {
                ...item,
                status: "Cancelled",
              }
            : item
        )
      );

      setRecordMode("view");
      setPendingCancellation(null);
    } catch {
      setCancelError("Failed to cancel booking.");
    } finally {
      setIsCancellingBooking(false);
    }
  };

  const handleSaveServices = async () => {
    if (!selectedBooking) {
      setServiceEditError("Select a booking first.");
      return;
    }

    if (editableServices.length === 0) {
      setServiceEditError("At least one service is required.");
      return;
    }

    setServiceEditError(null);
    setIsSavingServices(true);

    try {
      const response = await fetch("/api/reservations/services", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId: selectedBooking.id,
          services: editableServices.map((service) => ({
            serviceId: service.serviceId,
            quantity: Number(service.quantity),
          })),
        }),
      });

      let result: { success?: boolean; message?: string; errorCode?: string | null } | null = null;
      let rawText = "";

      try {
        result = (await response.json()) as { success?: boolean; message?: string; errorCode?: string | null };
      } catch {
        rawText = await response.text().catch(() => "");
      }

      if (!response.ok || !result?.success) {
        const statusLabel = `Save failed (${response.status})`;
        const codeLabel = result?.errorCode ? ` [${result.errorCode}]` : "";
        const rawLabel = rawText.trim() ? ` ${rawText.trim().slice(0, 200)}` : "";
        setServiceEditError(`${statusLabel}: ${result?.message ?? "Failed to update services."}${codeLabel}${rawLabel}`);
        return;
      }

      setReservationServicesById((current) => ({
        ...current,
        [selectedBooking.id]: editableServices,
      }));

      const supabase = createClient();
      const { data: transactionRow } = await supabase
        .from("transactions")
        .select("total_amount")
        .eq("reservation_id", selectedBooking.id)
        .maybeSingle<{ total_amount: number }>();

      if (transactionRow) {
        setBookings((currentBookings) =>
          currentBookings.map((booking) =>
            booking.id === selectedBooking.id
              ? {
                  ...booking,
                  totalAmount: Number(transactionRow.total_amount ?? booking.totalAmount),
                  remainingBalance: Math.max(
                    Number(transactionRow.total_amount ?? booking.totalAmount) - Number(booking.paidAmount ?? 0),
                    0
                  ),
                }
              : booking
          )
        );
      }

      setRecordMode("view");
    } catch {
      setServiceEditError("Failed to update services.");
    } finally {
      setIsSavingServices(false);
    }
  };

  const handleSubmitReschedule = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedBooking) {
      setRescheduleFormError("Select a booking first.");
      return;
    }

    if (selectedBooking.status.toLowerCase() === "cancelled" || selectedBooking.status.toLowerCase() === "completed") {
      setRescheduleFormError("This reservation can no longer be rescheduled.");
      return;
    }

    if (selectedBooking.status.toLowerCase() === "reschedule requested") {
      setRescheduleFormError("A reschedule request is already pending for this reservation.");
      return;
    }

    // if (!isAtLeastTwoDaysAway(selectedBooking.checkIn)) {
    //   setRescheduleFormError("Reschedule requests must be submitted at least 2 days before check-in.");
    //   return;
    // }

    const nextCheckIn = parseDateValue(rescheduleForm.checkIn);

    if (!nextCheckIn) {
      setRescheduleFormError("Please choose a valid reschedule date.");
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (nextCheckIn.getTime() < today.getTime()) {
      setRescheduleFormError("Reschedule date must be in the future.");
      return;
    }

    const currentBookingDate = parseDateValue(toDateOnly(selectedBooking.checkIn));
    if (currentBookingDate && nextCheckIn.getTime() === currentBookingDate.getTime()) {
      setRescheduleFormError("Please choose a different date from the current reservation.");
      return;
    }

    // Extract the original start and end times, then apply to new date
    const originalStart = new Date(selectedBooking.startDatetime);
    const originalEnd = new Date(selectedBooking.endDatetime);
    
    if (Number.isNaN(originalStart.getTime()) || Number.isNaN(originalEnd.getTime())) {
      setRescheduleFormError("Unable to determine original booking times.");
      return;
    }

    const originalStartHour = originalStart.getHours();
    const originalStartMinute = originalStart.getMinutes();
    const originalStartSecond = originalStart.getSeconds();
    
    const originalEndHour = originalEnd.getHours();
    const originalEndMinute = originalEnd.getMinutes();
    const originalEndSecond = originalEnd.getSeconds();

    // Calculate new end date based on whether end time is on same day or next day
    const durationMs = originalEnd.getTime() - originalStart.getTime();
    const daysInDuration = Math.floor(durationMs / (24 * 60 * 60 * 1000));
    
    const newStart = new Date(nextCheckIn);
    newStart.setHours(originalStartHour, originalStartMinute, originalStartSecond);
    
    const newEnd = new Date(newStart);
    newEnd.setTime(newStart.getTime() + durationMs);

    if (newStart.getTime() <= Date.now()) {
      setRescheduleFormError("Reschedule date/time must be in the future.");
      return;
    }

    setRescheduleFormError(null);
    setIsSubmittingReschedule(true);

    try {
      // Format dates for API
      const newCheckInStr = toDateOnly(newStart.toISOString());
      const newCheckOutStr = toDateOnly(newEnd.toISOString());

      const response = await fetch("/api/reservations/reschedule", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId: selectedBooking.id,
          newCheckInDate: newCheckInStr,
          newCheckOutDate: newCheckOutStr,
          newStartDatetime: newStart.toISOString(),
          newEndDatetime: newEnd.toISOString(),
        }),
      });

      const result = (await response.json().catch(() => null)) as { success?: boolean; message?: string } | null;

      if (!response.ok || !result?.success) {
        setRescheduleFormError(result?.message ?? "Failed to submit reschedule request.");
        return;
      }

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
    } catch {
      setRescheduleFormError("Failed to submit reschedule request.");
    } finally {
      setIsSubmittingReschedule(false);
    }
  };

  const handleSubmitRemainingPayment = (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedBooking || selectedBooking.remainingBalance <= 0) {
      setRemainingPaymentError("Select a booking with an outstanding balance first.");
      return;
    }

    if (selectedBooking.status.toLowerCase() === "cancelled" || selectedBooking.status.toLowerCase() === "completed") {
      setRemainingPaymentError("Cannot continue payment for this booking status.");
      return;
    }

    setRemainingPaymentError(null);
    setRemainingPaymentSuccess(null);
    openPaymentPortal(selectedBooking);
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

        const [guestResult, reservationsResult, ocularResult] = await Promise.all([
          supabase.from("guests").select("email, phone_number").eq("id", user.id).maybeSingle<GuestRow>(),
          supabase
            .from("reservations")
            .select("reservation_id, reference_number, start_datetime, end_datetime, booking_mode, adult_count, child_count, status")
            .eq("guest_id", user.id)
            .order("created_at", { ascending: false }),
          supabase
            .from("ocular_visits")
            .select("visit_id, reference_number, scheduled_date, time_slot, status, created_at")
            .eq("guest_id", user.id)
            .order("created_at", { ascending: false }),
        ]);

        if (reservationsResult.error || ocularResult.error) {
          throw reservationsResult.error || ocularResult.error;
        }

        const reservationRows = (reservationsResult.data as ReservationRow[] | null) ?? [];
        const reservationIds = reservationRows.map((row) => row.reservation_id);

        const [
          { data: transactionRows, error: transactionsError },
          { data: reservationServicesData, error: reservationServicesError },
          { data: availableServicesData, error: availableServicesError },
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
          supabase.from("services").select("service_id, name, price").eq("is_active", true).order("name", { ascending: true }),
        ]);

        if (transactionsError) {
          throw transactionsError;
        }

        if (reservationServicesError || availableServicesError) {
          throw reservationServicesError || availableServicesError;
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
          totalAmount: transactionByReservationId[reservation.reservation_id]?.total ?? 0,
          paidAmount: transactionByReservationId[reservation.reservation_id]?.paid ?? 0,
          remainingBalance: transactionByReservationId[reservation.reservation_id]?.balance ?? 0,
          status: toTitleCase(reservation.status),
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

        const mappedOcularBookings: OcularRecord[] = ((ocularResult.data as OcularVisitRow[] | null) ?? []).map(
          (visit) => ({
            id: visit.visit_id,
            reference: visit.reference_number,
            scheduledDate: visit.scheduled_date,
            timeSlot: visit.time_slot,
            status: toTitleCase(visit.status),
            notes: `Created ${formatDate(visit.created_at)}`,
          })
        );

        setBookings(mappedBookings);
        setOcularBookings(mappedOcularBookings);
        setReservationServicesById(nextReservationServicesById);
        setAvailableServices((availableServicesData as ServiceCatalogRow[] | null) ?? []);
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

  useEffect(() => {
    if (!bookings.length) {
      return;
    }

    const reservationIds = bookings.map((booking) => booking.id);

    const refreshTransactionSnapshots = async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("transactions")
        .select("reservation_id, total_amount, paid_amount, balance")
        .in("reservation_id", reservationIds);

      if (error) {
        return;
      }

      const nextByReservationId = ((data as TransactionRow[] | null) ?? []).reduce<
        Record<string, { total: number; paid: number; balance: number }>
      >((accumulator, transaction) => {
        accumulator[transaction.reservation_id] = {
          total: Number(transaction.total_amount ?? 0),
          paid: Number(transaction.paid_amount ?? 0),
          balance: Number(transaction.balance ?? 0),
        };
        return accumulator;
      }, {});

      setBookings((currentBookings) =>
        currentBookings.map((booking) => {
          const nextSnapshot = nextByReservationId[booking.id];

          if (!nextSnapshot) {
            return booking;
          }

          return {
            ...booking,
            totalAmount: nextSnapshot.total,
            paidAmount: nextSnapshot.paid,
            remainingBalance: nextSnapshot.balance,
          };
        })
      );
    };

    const timer = window.setInterval(() => {
      void refreshTransactionSnapshots();
    }, 20000);

    return () => {
      window.clearInterval(timer);
    };
  }, [bookings]);

  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      <section className="relative h-80 flex items-center justify-center overflow-hidden mt-20">
        <Image
          src="/website_cover.jpg"
          alt="Manage Booking"
          fill
          className="object-cover brightness-75"
          priority
        />
        <div className="absolute inset-0 bg-neutral/40" />
        <div className="relative z-10 text-center px-4">
          <h1 className="text-6xl font-bold text-base mb-4">Manage Booking</h1>
          <p className="text-xl text-base/90">Manage your bookings and ocular visit records in one place</p>
        </div>
      </section>

      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-3xl shadow-xl p-8">
            {fetchError ? (
              <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                {fetchError}
              </p>
            ) : null}

            <div className="mb-6 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
              <button
                onClick={() => {
                  setActiveTab("bookings");
                  setRecordMode(null);
                  setSelectedBookingId(null);
                }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === "bookings" ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"
                }`}
              >
                Booking Records
              </button>
              <button
                onClick={() => {
                  setActiveTab("ocular");
                  setRecordMode(null);
                  setSelectedOcularId(null);
                }}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === "ocular" ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"
                }`}
              >
                Ocular Booking Records
              </button>
            </div>

            {activeTab === "bookings" && (
              <>
                <h2 className="text-2xl font-bold text-neutral mb-4">Your Booking Records</h2>
                {cancelError ? (
                  <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                    {cancelError}
                  </p>
                ) : null}
                {isLoading ? <p className="mb-4 text-sm text-neutral/70">Loading booking records...</p> : null}
                <div className="overflow-x-auto rounded-2xl border border-neutral/10">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-neutral/10 bg-base text-neutral/70">
                      <tr>
                        <th className="px-4 py-3 font-medium">Reference</th>
                        <th className="px-4 py-3 font-medium">Check-in</th>
                        <th className="px-4 py-3 font-medium">Check-out</th>
                        <th className="px-4 py-3 font-medium">Guests</th>
                        <th className="px-4 py-3 font-medium">Amount</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!isLoading && bookings.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-6 text-center text-neutral/60">
                            No booking records found.
                          </td>
                        </tr>
                      ) : null}
                      {bookings.map((record) => (
                        <tr key={record.id} className="border-b border-neutral/10 last:border-none">
                          <td className="px-4 py-3 font-semibold text-neutral">{record.reference}</td>
                          <td className="px-4 py-3 text-neutral/80">{formatDateTime(record.checkIn)}</td>
                          <td className="px-4 py-3 text-neutral/80">{formatDateTime(record.checkOut)}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.guests}</td>
                          <td className="px-4 py-3 text-neutral/80">₱{record.totalAmount.toFixed(2)}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.status}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSelectedBookingId(record.id);
                                  setRecordMode("view");
                                  setRemainingPaymentError(null);
                                  setRemainingPaymentSuccess(null);
                                  setRemainingPaymentMethod("bank");
                                  setRemainingBankDetails({ accountName: "", referenceNumber: "", uploadProof: null });
                                  setRemainingEwalletDetails({ accountName: "", accountNumber: "", referenceNumber: "", uploadProof: null });
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                View
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedBookingId(record.id);
                                  setRecordMode("edit");
                                  setServiceEditError(null);
                                  setSelectedAddServiceId("");
                                  setAddServiceQuantity("1");
                                  setEditableServices(
                                    (reservationServicesById[record.id] ?? []).map((service) => ({
                                      ...service,
                                    }))
                                  );
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  const normalizedStatus = record.status.toLowerCase();

                                  if (
                                    normalizedStatus === "cancelled" ||
                                    normalizedStatus === "completed" ||
                                    normalizedStatus === "reschedule requested"
                                  ) {
                                    setCancelError("This reservation can no longer be rescheduled.");
                                    return;
                                  }

                                  setSelectedBookingId(record.id);
                                  setRecordMode("reschedule");
                                  setRescheduleFormError(null);
                                  setRescheduleForm({
                                        checkIn: (() => {
                                          const defaultDate = toDateOnly(record.checkIn);
                                          const minDate = getMinRescheduleDate(record);
                                          const defaultParsed = parseDateValue(defaultDate);
                                          const minParsed = parseDateValue(minDate);
                                          if (defaultParsed && minParsed && defaultParsed < minParsed) {
                                            return minDate;
                                          }
                                          return defaultDate;
                                        })(),
                                  });
                                }}
                                disabled={
                                  record.status.toLowerCase() === "cancelled" ||
                                  record.status.toLowerCase() === "completed" ||
                                  record.status.toLowerCase() === "reschedule requested"
                                }
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                Resched
                              </button>
                              <button
                                onClick={() => {
                                  if (
                                    record.remainingBalance <= 0 ||
                                    record.status.toLowerCase() === "cancelled" ||
                                    record.status.toLowerCase() === "completed"
                                  ) {
                                    return;
                                  }

                                  openPaymentPortal(record);
                                }}
                                disabled={
                                  record.remainingBalance <= 0 ||
                                  record.status.toLowerCase() === "cancelled" ||
                                  record.status.toLowerCase() === "completed"
                                }
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Pay Balance
                              </button>
                              <button
                                onClick={() => {
                                  setCancelError(null);

                                  if (record.status.toLowerCase() === "cancelled") {
                                    setCancelError("This reservation is already cancelled.");
                                    return;
                                  }
                                  // i commented this
                                  // if (getDaysBeforeCheckIn(record.checkIn) < 2) {
                                  //   setCancelError("Cancellation is only allowed at least 2 days before check-in.");
                                  //   return;
                                  // }

                                  setPendingCancellation({
                                    id: record.id,
                                    reference: record.reference,
                                    checkIn: record.checkIn,
                                  });
                                  
                                  console.log("Pending cancellation set:", {
                                    id: record.id,
                                    reference: record.reference,
                                    checkIn: record.checkIn,
                                  });
                                  
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {recordMode === "view" && selectedBooking && (
                  <div className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Booking Details</h3>
                    <div className="grid gap-3 md:grid-cols-2 text-sm text-neutral/80">
                      <p>
                        Reference: <span className="font-semibold text-neutral">{selectedBooking.reference}</span>
                      </p>
                      <p>
                        Status: <span className="font-semibold text-neutral">{selectedBooking.status}</span>
                      </p>
                      <p>
                        Check-in: <span className="font-semibold text-neutral">{formatDateTime(selectedBooking.checkIn)}</span>
                      </p>
                      <p>
                        Check-out: <span className="font-semibold text-neutral">{formatDateTime(selectedBooking.checkOut)}</span>
                      </p>
                      <p>
                        Guests: <span className="font-semibold text-neutral">{selectedBooking.guests}</span>
                      </p>
                      <p>
                        Total Amount: <span className="font-semibold text-neutral">₱{selectedBooking.totalAmount.toFixed(2)}</span>
                      </p>
                      <p>
                        Paid Amount: <span className="font-semibold text-neutral">₱{selectedBooking.paidAmount.toFixed(2)}</span>
                      </p>
                      <p>
                        Remaining Balance: <span className="font-semibold text-neutral">₱{selectedBooking.remainingBalance.toFixed(2)}</span>
                      </p>
                      <div className="md:col-span-2">
                        <p className="font-medium text-neutral">Booked Services</p>
                        {(reservationServicesById[selectedBooking.id] ?? []).length === 0 ? (
                          <p className="mt-1">No services selected.</p>
                        ) : (
                          <div className="mt-2 space-y-1">
                            {(reservationServicesById[selectedBooking.id] ?? []).map((service) => (
                              <p key={service.serviceId}>
                                {service.name} x {service.quantity} ({formatCurrency(service.priceAtTime)} each)
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {selectedBooking.remainingBalance > 0 &&
                    selectedBooking.status.toLowerCase() !== "cancelled" &&
                    selectedBooking.status.toLowerCase() !== "completed" ? (
                      <form className="mt-5 rounded-xl border border-neutral/10 bg-white p-4" onSubmit={handleSubmitRemainingPayment}>
                        <h4 className="font-semibold text-neutral">Pay Remaining Balance</h4>
                        <p className="mt-1 text-sm text-neutral/70">
                          Amount to pay now: <span className="font-semibold text-neutral">{formatCurrency(selectedBooking.remainingBalance)}</span>
                        </p>

                        {remainingPaymentError ? (
                          <p className="mt-3 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                            {remainingPaymentError}
                          </p>
                        ) : null}

                        {remainingPaymentSuccess ? (
                          <p className="mt-3 rounded-lg border border-secondary/30 bg-secondary/10 px-3 py-2 text-sm text-neutral">
                            {remainingPaymentSuccess}
                          </p>
                        ) : null}

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <button
                            type="button"
                            onClick={() => setRemainingPaymentMethod("bank")}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              remainingPaymentMethod === "bank"
                                ? "border-primary bg-primary/5 text-neutral"
                                : "border-neutral/20 bg-base text-neutral"
                            }`}
                          >
                            Bank Transfer
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemainingPaymentMethod("ewallet")}
                            className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                              remainingPaymentMethod === "ewallet"
                                ? "border-primary bg-primary/5 text-neutral"
                                : "border-neutral/20 bg-base text-neutral"
                            }`}
                          >
                            E-Wallet
                          </button>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <input
                            type="text"
                            placeholder="Account Name"
                            value={
                              remainingPaymentMethod === "bank"
                                ? remainingBankDetails.accountName
                                : remainingEwalletDetails.accountName
                            }
                            onChange={(event) => {
                              const next = event.target.value;
                              if (remainingPaymentMethod === "bank") {
                                setRemainingBankDetails((prev) => ({ ...prev, accountName: next }));
                              } else {
                                setRemainingEwalletDetails((prev) => ({ ...prev, accountName: next }));
                              }
                            }}
                            className="rounded-lg border border-neutral/20 px-3 py-2"
                          />

                          <input
                            type="text"
                            placeholder="Reference Number"
                            value={
                              remainingPaymentMethod === "bank"
                                ? remainingBankDetails.referenceNumber
                                : remainingEwalletDetails.referenceNumber
                            }
                            onChange={(event) => {
                              const next = event.target.value;
                              if (remainingPaymentMethod === "bank") {
                                setRemainingBankDetails((prev) => ({ ...prev, referenceNumber: next }));
                              } else {
                                setRemainingEwalletDetails((prev) => ({ ...prev, referenceNumber: next }));
                              }
                            }}
                            className="rounded-lg border border-neutral/20 px-3 py-2"
                          />

                          {remainingPaymentMethod === "ewallet" ? (
                            <input
                              type="text"
                              placeholder="Account Number"
                              value={remainingEwalletDetails.accountNumber}
                              onChange={(event) =>
                                setRemainingEwalletDetails((prev) => ({ ...prev, accountNumber: event.target.value }))
                              }
                              className="rounded-lg border border-neutral/20 px-3 py-2"
                            />
                          ) : null}

                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              if (remainingPaymentMethod === "bank") {
                                setRemainingBankDetails((prev) => ({ ...prev, uploadProof: file }));
                              } else {
                                setRemainingEwalletDetails((prev) => ({ ...prev, uploadProof: file }));
                              }
                            }}
                            className="rounded-lg border border-neutral/20 px-3 py-2"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={isSubmittingRemainingPayment}
                          className="mt-4 rounded-full bg-primary px-6 py-3 font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSubmittingRemainingPayment ? "Submitting Payment..." : "Pay Remaining Balance"}
                        </button>
                      </form>
                    ) : null}
                  </div>
                )}

                {recordMode === "edit" && selectedBooking && (
                  <form
                    className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5 space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveServices();
                    }}
                  >
                    <h3 className="text-lg font-semibold text-neutral">Edit Booking Services</h3>
                    <p className="text-sm text-neutral/70">
                      You can add new services or increase quantities. Existing services cannot be reduced or removed.
                    </p>

                    {serviceEditError ? (
                      <p className="rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                        {serviceEditError}
                      </p>
                    ) : null}

                    <div className="space-y-3">
                      {editableServices.length === 0 ? (
                        <p className="text-sm text-neutral/70">No services yet. Add one below to continue.</p>
                      ) : null}

                      {editableServices.map((service) => (
                        <div key={service.serviceId} className="grid gap-3 rounded-xl border border-neutral/10 bg-white p-3 md:grid-cols-3">
                          <p className="text-sm text-neutral">
                            <span className="font-semibold">{service.name}</span>
                            <span className="block text-neutral/70">{formatCurrency(service.priceAtTime)} each</span>
                          </p>
                          <div>
                            <label className="mb-1 block text-xs text-neutral/70">Quantity</label>
                            <input
                              type="number"
                              min={service.minQuantity}
                              step={1}
                              value={service.quantity}
                              onChange={(event) => {
                                const parsedValue = Number.parseInt(event.target.value, 10);
                                const nextQuantity = Number.isNaN(parsedValue)
                                  ? service.minQuantity
                                  : Math.max(service.minQuantity, parsedValue);

                                setEditableServices((current) =>
                                  current.map((currentService) =>
                                    currentService.serviceId === service.serviceId
                                      ? {
                                          ...currentService,
                                          quantity: nextQuantity,
                                        }
                                      : currentService
                                  )
                                );
                              }}
                              className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                            />
                          </div>
                          <p className="text-xs text-neutral/70 md:text-sm">Minimum allowed: {service.minQuantity}</p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-xl border border-neutral/10 bg-white p-3">
                      <p className="mb-3 text-sm font-semibold text-neutral">Add New Service</p>
                      <div className="grid gap-3 md:grid-cols-3">
                        <select
                          value={selectedAddServiceId}
                          onChange={(event) => setSelectedAddServiceId(event.target.value)}
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        >
                          <option value="">Select a service</option>
                          {availableServices
                            .filter((service) => !editableServices.some((entry) => entry.serviceId === service.service_id))
                            .map((service) => (
                              <option key={service.service_id} value={service.service_id}>
                                {service.name} ({formatCurrency(Number(service.price ?? 0))})
                              </option>
                            ))}
                        </select>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={addServiceQuantity}
                          onChange={(event) => setAddServiceQuantity(event.target.value)}
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setServiceEditError(null);

                            if (!selectedAddServiceId) {
                              setServiceEditError("Select a service to add.");
                              return;
                            }

                            const selectedService = availableServices.find(
                              (service) => service.service_id === selectedAddServiceId
                            );

                            if (!selectedService) {
                              setServiceEditError("Selected service is no longer available.");
                              return;
                            }

                            const parsedQuantity = Number.parseInt(addServiceQuantity, 10);
                            const nextQuantity = Number.isNaN(parsedQuantity) ? 1 : Math.max(1, parsedQuantity);

                            setEditableServices((current) => [
                              ...current,
                              {
                                serviceId: selectedService.service_id,
                                name: selectedService.name,
                                quantity: nextQuantity,
                                minQuantity: 1,
                                priceAtTime: Number(selectedService.price ?? 0),
                              },
                            ]);
                            setSelectedAddServiceId("");
                            setAddServiceQuantity("1");
                          }}
                          className="rounded-lg border border-neutral/20 px-3 py-2 text-sm font-medium text-neutral hover:bg-base"
                        >
                          Add Service
                        </button>
                      </div>
                    </div>

                    <button
                      disabled={isSavingServices}
                      className="rounded-full bg-primary px-6 py-3 font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSavingServices ? "Saving..." : "Save Service Changes"}
                    </button>
                  </form>
                )}

                {recordMode === "reschedule" && selectedBooking && (
                  <form
                    className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5 space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSubmitReschedule(event);
                    }}
                  >
                    <h3 className="text-lg font-semibold text-neutral">Reschedule Booking</h3>

                    {rescheduleFormError ? (
                      <p className="rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                        {rescheduleFormError}
                      </p>
                    ) : null}

                    <div className="rounded-lg bg-neutral/5 p-4 space-y-2 text-sm">
                      <p><span className="text-neutral/70">Booking Mode:</span> <span className="font-semibold text-neutral capitalize">{selectedBooking.bookingMode?.replace(/_/g, " ") || "Unknown"}</span></p>
                      <p><span className="text-neutral/70">Current Check-in:</span> <span className="font-semibold text-neutral">{formatDate(selectedBooking.checkIn)}</span></p>
                      <p><span className="text-neutral/70">Current Check-out:</span> <span className="font-semibold text-neutral">{formatDate(selectedBooking.checkOut)}</span></p>
                      {selectedBooking.startDatetime && selectedBooking.endDatetime && (
                        <>
                          <p><span className="text-neutral/70">Start Time:</span> <span className="font-semibold text-neutral">{new Date(selectedBooking.startDatetime).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}</span></p>
                          <p><span className="text-neutral/70">End Time:</span> <span className="font-semibold text-neutral">{new Date(selectedBooking.endDatetime).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}</span></p>
                        </>
                      )}
                    </div>

                    <div className="grid gap-4">
                      <div>
                        <label className="mb-2 block text-sm text-neutral/70">New Check-in Date</label>
                        <input
                          type="date"
                          value={rescheduleForm.checkIn}
                          min={minRescheduleDate}
                          onChange={(event) =>
                            setRescheduleForm((current) => ({
                              ...current,
                              checkIn: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        />
                        <p className="mt-1 text-xs text-neutral/60">Check-out will be automatically calculated based on your booking mode and duration.</p>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={isSubmittingReschedule}
                      className="rounded-full bg-primary px-6 py-3 font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmittingReschedule ? "Submitting Request..." : "Submit Reschedule Request"}
                    </button>
                  </form>
                )}

              </>
            )}

            {activeTab === "ocular" && (
              <>
                <h2 className="text-2xl font-bold text-neutral mb-4">Your Ocular Booking Records</h2>
                {ocularCancelError ? (
                  <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
                    {ocularCancelError}
                  </p>
                ) : null}

                {isLoading ? <p className="mb-4 text-sm text-neutral/70">Loading ocular visit records...</p> : null}
                <div className="overflow-x-auto rounded-2xl border border-neutral/10">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-neutral/10 bg-base text-neutral/70">
                      <tr>
                        <th className="px-4 py-3 font-medium">Reference</th>
                        <th className="px-4 py-3 font-medium">Scheduled Date</th>
                        <th className="px-4 py-3 font-medium">Time Slot</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Notes</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {!isLoading && ocularBookings.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-neutral/60">
                            No ocular visit records found.
                          </td>
                        </tr>
                      ) : null}
                      {ocularBookings.map((record) => (
                        <tr key={record.id} className="border-b border-neutral/10 last:border-none">
                          <td className="px-4 py-3 font-semibold text-neutral">{record.reference}</td>
                          <td className="px-4 py-3 text-neutral/80">{formatDate(record.scheduledDate)}</td>
                          <td className="px-4 py-3 text-neutral/80">{formatTimeSlot(record.timeSlot)}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.status}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.notes}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSelectedOcularId(record.id);
                                  setRecordMode("view");
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                View
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedOcularId(record.id);
                                  setRecordMode("edit");
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                Edit
                              </button>
                                <button
                                  onClick={() => {
                                    if (record.status.toLowerCase() === "cancelled") {
                                      setOcularCancelError("This ocular visit is already cancelled.");
                                      return;
                                    }

                                    setPendingOcularCancellation({
                                      id: record.id,
                                      reference: record.reference,
                                    });
                                  }}
                                  disabled={record.status.toLowerCase() === "cancelled"}
                                  className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Cancel
                                </button>


                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {recordMode === "view" && selectedOcular && (
                  <div className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5">
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
                    className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5 space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setRecordMode("view");
                    }}
                  >
                    <h3 className="text-lg font-semibold text-neutral">Edit Ocular Visit</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm text-neutral/70">Scheduled Date</label>
                        <input
                          type="date"
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                          onChange={(event) =>
                            setOcularBookings((prev) =>
                              prev.map((item) =>
                                item.id === selectedOcular.id
                                  ? { ...item, scheduledDate: event.target.value || item.scheduledDate }
                                  : item
                              )
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-neutral/70">Time Slot</label>
                        <select
                          value={selectedOcular.timeSlot}
                          onChange={(event) =>
                            setOcularBookings((prev) =>
                              prev.map((item) =>
                                item.id === selectedOcular.id ? { ...item, timeSlot: event.target.value } : item
                              )
                            )
                          }
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        >
                          <option value="08:00-09:00">{formatTimeSlot("08:00-09:00")}</option>
                          <option value="09:00-10:00">{formatTimeSlot("09:00-10:00")}</option>
                          <option value="10:00-11:00">{formatTimeSlot("10:00-11:00")}</option>
                          <option value="13:00-14:00">{formatTimeSlot("13:00-14:00")}</option>
                          <option value="14:00-15:00">{formatTimeSlot("14:00-15:00")}</option>
                        </select>
                      </div>
                    </div>
                    <button className="rounded-full bg-primary px-6 py-3 font-semibold text-base hover:bg-primary/90">
                      Save Changes
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      <ConfirmationDialog
        isOpen={Boolean(pendingCancellation)}
        title="Cancel Booking"
        message={`Cancel booking ${pendingCancellation?.reference ?? ""}? This action follows the no-refund policy and can only be requested at least 2 days before check-in.`}
        confirmText="Confirm Cancel"
        cancelText="Keep Booking"
        isConfirming={isCancellingBooking}
        onCancel={() => {
          if (!isCancellingBooking) {
            setPendingCancellation(null);
          }
        }}
        onConfirm={() => {
          if (pendingCancellation) {
            void handleCancelReservation(pendingCancellation.id);
          }
        }}
      />


    <ConfirmationDialog
      isOpen={Boolean(pendingOcularCancellation)}
      title="Cancel Ocular Visit"
      message={`Cancel ocular visit ${pendingOcularCancellation?.reference ?? ""}?`}
      confirmText="Confirm Cancel"
      cancelText="Keep Visit"
      isConfirming={isCancellingOcular}
      onCancel={() => {
        if (!isCancellingOcular) {
          setPendingOcularCancellation(null);
        }
      }}
      onConfirm={() => {
        if (pendingOcularCancellation) {
          void handleCancelOcularVisit(pendingOcularCancellation.id);
        }
      }}
    />



      <Footer />
    </div>
  );
}
