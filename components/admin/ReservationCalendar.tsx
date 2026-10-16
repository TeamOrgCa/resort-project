"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ManualBookingDialog from "@/components/admin/ManualBookingDialog";
import ReservationEditor from "@/components/admin/ReservationEditor";
import CancellationDialog from "@/components/CancellationDialog";
import OcularVisitReview from "@/components/admin/OcularVisitReview";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import RecordDialog from "@/components/manage/RecordDialog";
import LoadingState from "@/components/ui/LoadingState";
import ReservationPaymentReview from "@/components/admin/transactions/ReservationPaymentReview";
import { ATTENTION_LABELS, calendarBookingKind, reservationAttention, type AttentionFlag, type CalendarSignals } from "@/lib/booking/calendar-attention";
import { hasPermission, type Permission } from "@/lib/auth/role-access";
import type { StaffRole } from "@/lib/auth/staff-auth";
import { manilaDateKey } from "@/lib/booking/manila-date";
import { buildBookingWindow } from "@/lib/booking/policy";
import { isWindowAvailable } from "@/lib/booking/availability";
import { createClient } from "@/lib/supabase/client";

type Reservation = {
  reservation_id: string;
  reference_number: string;
  guest_id: string | null;
  walk_in_guest_id: string | null;
  start_datetime: string;
  end_datetime: string;
  adult_count: number;
  child_count: number;
  status: string;
  booking_mode: string | null;
  booking_type: string | null;
  special_requests: string | null;
  payment_deadline_at: string | null;
  created_at: string;
  checked_in_at: string | null;
  checked_out_at?: string | null;
};

type OcularVisit = {
  visit_id: string;
  reference_number: string;
  guest_id: string;
  scheduled_date: string;
  status: string;
  review_reason?: string | null;
};

type Guest = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
};

type WalkInGuest = Omit<Guest, "id"> & { walk_in_guest_id: string };
type MaintenanceBlock = { block_id: string; name: string; reason: string; start_date: string; end_date: string; status: string };
type EventKind = "booking" | "reservation" | "closed" | "ocular" | "maintenance";

type CalendarEvent = {
  id: string;
  kind: EventKind;
  date: string;
  label: string;
  reference?: string;
  reservationId?: string;
  status?: string;
  flags?: AttentionFlag[];
};

const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const eventStyles: Record<EventKind, { label: string; className: string; dotClassName: string }> = {
  booking: { label: "Booking request", className: "border-amber-500 bg-amber-50 text-amber-900", dotClassName: "bg-amber-500" },
  reservation: { label: "Confirmed reservation", className: "border-blue-600 bg-blue-50 text-blue-900", dotClassName: "bg-blue-600" },
  closed: { label: "Closed booking", className: "border-neutral/30 bg-neutral/5 text-neutral/60", dotClassName: "bg-neutral/40" },
  ocular: { label: "Ocular visit", className: "border-teal-600 bg-teal-50 text-teal-800", dotClassName: "bg-teal-600" },
  maintenance: { label: "Maintenance", className: "border-slate-500 bg-slate-100 text-slate-700", dotClassName: "bg-slate-500" },
};

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfMonthGrid = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
};
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const addDaysUtc = (date: Date, amount: number) => new Date(date.getTime() + amount * 86_400_000);
const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" });
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ReservationCalendar({ initialReservationId, initialDate, openNew = false, initialAccess }: {
  initialReservationId?: string; initialDate?: string; openNew?: boolean;
  initialAccess?: { role: StaffRole; permissions: string[] };
}) {
  const initiallyAllowed = (permission: Permission) => Boolean(initialAccess && hasPermission(initialAccess.role, initialAccess.permissions, permission));
  const [month, setMonth] = useState(() => new Date(`${initialDate ?? manilaDateKey(new Date())}T12:00:00`));
  const [refreshKey, setRefreshKey] = useState(0);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [ocularVisits, setOcularVisits] = useState<OcularVisit[]>([]);
  const [maintenanceBlocks, setMaintenanceBlocks] = useState<MaintenanceBlock[]>([]);
  const [isAdmin, setIsAdmin] = useState(initialAccess?.role === "admin");
  const [canCancel, setCanCancel] = useState(initiallyAllowed("cancel_reservation"));
  const [canCreate, setCanCreate] = useState(initiallyAllowed("create_reservation"));
  const [canCheckIn, setCanCheckIn] = useState(initiallyAllowed("edit_reservation"));
  const [canTransactions, setCanTransactions] = useState(initiallyAllowed("transactions"));
  const [canRecords, setCanRecords] = useState(initiallyAllowed("records"));
  const [canReviewPayments, setCanReviewPayments] = useState(initiallyAllowed("payment_approval"));
  const [canReviewOcular, setCanReviewOcular] = useState(initiallyAllowed("ocular_approval"));
  const [ocularBusy, setOcularBusy] = useState(false);
  const [departureConfirmed, setDepartureConfirmed] = useState(false);
  const attendanceSubmitting = useRef(false);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentRevision, setPaymentRevision] = useState(0);
  const [editorBusy, setEditorBusy] = useState(false);
  const [signals, setSignals] = useState<Record<string, CalendarSignals>>({});
  const [attentionFilter, setAttentionFilter] = useState<"all" | "attention" | AttentionFlag>("all");
  const [selectedDay, setSelectedDay] = useState(initialDate ?? manilaDateKey(new Date()));
  const [mobileView, setMobileView] = useState<"Week" | "Month" | "Agenda">("Month");
  const [arrivalConfirmed, setArrivalConfirmed] = useState(false);
  const [checkInBusy, setCheckInBusy] = useState(false);
  const [checkInError, setCheckInError] = useState<string | null>(null);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancellationMessage, setCancellationMessage] = useState<string | null>(null);
  const [showBlockForm, setShowBlockForm] = useState(false);
  const [blockName, setBlockName] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [blockStart, setBlockStart] = useState("");
  const [blockEnd, setBlockEnd] = useState("");
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockMessage, setBlockMessage] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [guests, setGuests] = useState<Record<string, Guest>>({});
  const [walkInGuests, setWalkInGuests] = useState<Record<string, WalkInGuest>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [isManualBookingOpen, setIsManualBookingOpen] = useState(openNew);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(() => initialReservationId ? { id: initialReservationId, kind: "reservation", date: initialDate ?? "", label: "Reservation details", reservationId: initialReservationId } : null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let mounted = true;
    let requestId = 0;

    const loadCalendarData = async (initial = false) => {
      const currentRequest = ++requestId;
      if (initial) setIsLoading(true);
      setError(null);

      try {
        const supabase = createClient();
        const gridStart = dateKey(startOfMonthGrid(month));
        const gridEnd = dateKey(addDays(startOfMonthGrid(month), 42));
        const availabilityEnd = dateKey(addDays(startOfMonthGrid(month), 43));
        const [{ data: reservationData, error: reservationError }, { data: ocularData, error: ocularError }, blocksResponse] = await Promise.all([
          supabase.from("reservations").select("reservation_id, reference_number, guest_id, walk_in_guest_id, start_datetime, end_datetime, adult_count, child_count, status, booking_mode, booking_type, special_requests, payment_deadline_at, created_at, checked_in_at, checked_out_at").neq("status", "expired").lt("start_datetime", `${availabilityEnd}T00:00:00+08:00`).gt("end_datetime", `${gridStart}T00:00:00+08:00`).order("start_datetime", { ascending: true }).limit(1000),
          supabase.from("ocular_visits").select("visit_id, reference_number, guest_id, scheduled_date, status, review_reason").gte("scheduled_date", gridStart).lt("scheduled_date", gridEnd).order("scheduled_date", { ascending: true }).limit(300),
          fetch(`/api/admin/maintenance-blocks?start=${gridStart}&end=${availabilityEnd}`, { cache: "no-store" }),
        ]);

        if (reservationError || ocularError || !blocksResponse.ok) throw reservationError ?? ocularError ?? new Error("Unable to load maintenance blocks.");
        const blocksPayload = await blocksResponse.json() as { blocks?: MaintenanceBlock[] };

        const reservationRows = (reservationData as Reservation[] | null) ?? [];
        if (reservationRows.length >= 1000) throw new Error("Too many bookings to show safely. Please contact the administrator.");
        const ids = reservationRows.map(row => row.reservation_id);
        // Read workflow records themselves: confirmed bookings may also have a new pending payment.
        const signalResults = ids.length ? await Promise.all([
          supabase.from("payments").select("reservation_id").in("reservation_id", ids).eq("status", "pending").limit(5000),
          supabase.from("reservation_reschedules").select("reservation_id").in("reservation_id", ids).eq("status", "pending").limit(5000),
          supabase.from("refund_requests").select("reservation_id").in("reservation_id", ids).in("status", ["pending", "reviewed", "approved", "payout_submitted"]).limit(5000),
          supabase.from("transactions").select("reservation_id, balance").in("reservation_id", ids).limit(1000),
        ]) : [];
        if (signalResults.some(result => result.error)) throw new Error("Unable to load payment, reschedule, refund or balance flags. Refresh the calendar.");
        const nextSignals: Record<string, CalendarSignals> = {};
        signalResults.forEach((result, index) => result.data?.forEach(row => {
          const signal = nextSignals[row.reservation_id] ??= {};
          if (index === 0) signal.payment = true;
          if (index === 1) signal.reschedule = true;
          if (index === 2) signal.refund = true;
          if (index === 3 && "balance" in row) signal.balance = Number(row.balance);
        }));
        const ocularRows = (ocularData as OcularVisit[] | null) ?? [];
        const guestIds = [...new Set([...reservationRows.map((row) => row.guest_id), ...ocularRows.map((row) => row.guest_id)].filter((id): id is string => Boolean(id)))];
        const walkInIds = [...new Set(reservationRows.map((row) => row.walk_in_guest_id).filter((id): id is string => Boolean(id)))];
        const [{ data: guestData, error: guestError }, { data: walkInData, error: walkInError }] = await Promise.all([
          guestIds.length ? supabase.from("guests").select("id, first_name, last_name, email, phone_number").in("id", guestIds) : Promise.resolve({ data: [], error: null }),
          walkInIds.length ? supabase.from("walk_in_guests").select("walk_in_guest_id, first_name, last_name, email, phone_number").in("walk_in_guest_id", walkInIds) : Promise.resolve({ data: [], error: null }),
        ]);

        if (guestError || walkInError) throw guestError ?? walkInError;
        if (!mounted || currentRequest !== requestId) return;

        setReservations(reservationRows);
        setSignals(nextSignals);
        setOcularVisits(ocularRows);
        setMaintenanceBlocks(blocksPayload.blocks ?? []);
        setGuests(((guestData as Guest[] | null) ?? []).reduce<Record<string, Guest>>((map, guest) => ({ ...map, [guest.id]: guest }), {}));
        setWalkInGuests(((walkInData as WalkInGuest[] | null) ?? []).reduce<Record<string, WalkInGuest>>((map, guest) => ({ ...map, [guest.walk_in_guest_id]: guest }), {}));
      } catch (cause) {
        if (mounted && currentRequest === requestId) setError(cause && typeof cause === "object" && "code" in cause && cause.code === "42703"
          ? "Apply docs/stay-completion-migration.sql and docs/ocular-review-migration.sql after their prerequisite migrations, then refresh the calendar."
          : cause instanceof Error ? cause.message : "Failed to load the reservation calendar. Please refresh.");
      } finally {
        if (mounted && currentRequest === requestId) setIsLoading(false);
      }
    };

    void loadCalendarData(true);
    const refresh = window.setInterval(() => {
      setNow(Date.now());
      void loadCalendarData();
    }, 30_000);
    window.addEventListener("focus", onFocus);
    function onFocus() {
      setNow(Date.now());
      void loadCalendarData();
    }
    return () => {
      mounted = false;
      window.clearInterval(refresh);
      window.removeEventListener("focus", onFocus);
    };
  }, [month, refreshKey]);

  useEffect(() => {
    if (initialAccess) return;
    void (async () => {
      const client = createClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) return;
      const { data } = await client.from("staff_users").select("role, is_active").eq("id", user.id).maybeSingle();
      setIsAdmin(data?.role === "admin" && data.is_active === true);
      if (data?.role && data.is_active) {
        const { data: grants } = await client.from("role_permissions").select("permissions").eq("role", data.role).maybeSingle();
        setCanCancel(hasPermission(data.role as StaffRole, grants?.permissions ?? [], "cancel_reservation"));
        setCanCreate(hasPermission(data.role as StaffRole, grants?.permissions ?? [], "create_reservation"));
        setCanCheckIn(hasPermission(data.role as StaffRole, grants?.permissions ?? [], "edit_reservation"));
        setCanTransactions(hasPermission(data.role as StaffRole, grants?.permissions ?? [], "transactions"));
        setCanRecords(hasPermission(data.role as StaffRole, grants?.permissions ?? [], "records"));
        setCanReviewOcular(hasPermission(data.role as StaffRole, grants?.permissions ?? [], "ocular_approval"));
        setCanReviewPayments(hasPermission(data.role as StaffRole, grants?.permissions ?? [], "payment_approval"));
      }
    })();
  }, [initialAccess]);

  const saveBlock = async () => {
    if (blockBusy) return;
    setBlockBusy(true); setBlockMessage(null); setBlockError(null);
    try {
      const response = await fetch("/api/admin/maintenance-blocks", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: blockName, reason: blockReason, startDate: blockStart, endDate: blockEnd }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Unable to create block.");
      setBlockMessage(result.message ?? "Dates blocked and guest alerts created.");
      setShowBlockForm(false);
      setSearchTerm(""); setAttentionFilter("all");
      setMonth(new Date(`${blockStart}T12:00:00`)); setSelectedDay(blockStart);
      setRefreshKey(key => key + 1);
    } catch (error) { setBlockError(error instanceof Error ? error.message : "Unable to create block."); }
    finally { setBlockBusy(false); }
  };

  const releaseBlock = async (blockId: string) => {
    setBlockBusy(true); setBlockMessage(null); setBlockError(null);
    try {
      const response = await fetch("/api/admin/maintenance-blocks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blockId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Unable to release block.");
      setMaintenanceBlocks((blocks) => blocks.map((block) => block.block_id === blockId ? { ...block, status: "released" } : block));
      setSelectedEvent(null); setBlockMessage("Maintenance block released.");
    } catch (error) { setBlockError(error instanceof Error ? error.message : "Unable to release block."); }
    finally { setBlockBusy(false); }
  };

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const gridStart = dateKey(startOfMonthGrid(month));
    const gridEnd = dateKey(addDays(startOfMonthGrid(month), 42));
    const reservationEvents = reservations.filter((reservation) =>
      reservation.status !== "expired" &&
      !(reservation.status === "pending" && reservation.payment_deadline_at &&
        new Date(reservation.payment_deadline_at).getTime() <= now)
    ).flatMap((reservation) => {
      const guest = reservation.guest_id ? guests[reservation.guest_id] : reservation.walk_in_guest_id ? walkInGuests[reservation.walk_in_guest_id] : null;
      const startDay = manilaDateKey(reservation.start_datetime);
      const lastDay = manilaDateKey(new Date(new Date(reservation.end_datetime).getTime() - 1));
      const events: CalendarEvent[] = [];
      for (let day = new Date(`${startDay}T00:00:00Z`); day <= new Date(`${lastDay}T00:00:00Z`); day = addDaysUtc(day, 1)) {
        const occupiedDate = day.toISOString().slice(0, 10);
        if (occupiedDate < gridStart || occupiedDate >= gridEnd) continue;
        events.push({
          id: `${reservation.reservation_id}:${occupiedDate}`,
          kind: calendarBookingKind(reservation.status),
          flags: reservationAttention(reservation, signals[reservation.reservation_id], now),
          date: occupiedDate,
          label: guest ? `${guest.first_name} ${guest.last_name}` : reservation.reference_number,
          reference: reservation.reference_number,
          reservationId: reservation.reservation_id,
          status: reservation.status,
        });
      }
      return events;
    });
    const ocularEvents = ocularVisits.map((visit) => ({
      id: visit.visit_id,
      kind: "ocular" as const,
      date: visit.scheduled_date,
      label: `Ocular visit · ${visit.reference_number}`,
      reference: visit.reference_number,
      status: visit.status,
    }));
    const maintenanceEvents = maintenanceBlocks.filter((block) => block.status === "active").flatMap((block) => {
      const events: CalendarEvent[] = [];
      for (let day = new Date(`${block.start_date}T00:00:00Z`); day <= new Date(`${block.end_date}T00:00:00Z`); day = addDaysUtc(day, 1)) {
        events.push({ id: `${block.block_id}:${day.toISOString().slice(0, 10)}`, kind: "maintenance",
          date: day.toISOString().slice(0, 10), label: block.name, reference: block.reason, status: "blocked" });
      }
      return events;
    });
    return [...reservationEvents, ...ocularEvents, ...maintenanceEvents].filter((event) => event.date);
  }, [guests, maintenanceBlocks, month, now, ocularVisits, reservations, walkInGuests, signals]);

  const eventsByDay = useMemo(() => calendarEvents.reduce<Record<string, CalendarEvent[]>>((map, event) => {
    map[event.date] = [...(map[event.date] ?? []), event];
    return map;
  }, {}), [calendarEvents]);
  const filteredEventsByDay = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return Object.entries(eventsByDay).reduce<Record<string, CalendarEvent[]>>((map, [date, events]) => {
      const matchingEvents = events.filter((event) =>
        `${event.label} ${event.reference ?? ""} ${eventStyles[event.kind].label} ${event.status ?? ""} ${(event.flags ?? []).map(flag => ATTENTION_LABELS[flag]).join(" ")}`.toLowerCase().includes(normalizedSearch)
        && (attentionFilter === "all" || (attentionFilter === "attention" ? Boolean(event.flags?.length) : event.flags?.includes(attentionFilter)))
      );
      if (matchingEvents.length) map[date] = matchingEvents;
      return map;
    }, {});
  }, [eventsByDay, searchTerm, attentionFilter]);
  const calendarDays = useMemo(() => {
    const start = startOfMonthGrid(month);
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [month]);
  const availabilityByDay = useMemo(() => {
    const activeReservations = reservations.filter((reservation) =>
      ["pending", "payment_submitted", "confirmed", "reschedule_requested"].includes(reservation.status) &&
      !(reservation.status === "pending" && reservation.payment_deadline_at &&
        new Date(reservation.payment_deadline_at).getTime() <= now)
    );
    return Object.fromEntries(calendarDays.map((date) => {
      const key = dateKey(date);
      const isAvailable = (mode: "day" | "night") => {
        const window = buildBookingWindow({ bookingMode: mode, date });
        if (typeof window.startDatetime !== "string" || typeof window.endDatetime !== "string") return false;
        const lastDay = manilaDateKey(new Date(new Date(window.endDatetime).getTime() - 1));
        if (maintenanceBlocks.some((block) => block.status === "active" && block.start_date <= lastDay && block.end_date >= key)) return false;
        return isWindowAvailable(window.startDatetime, window.endDatetime, activeReservations);
      };
      return [key, { day: isAvailable("day"), night: isAvailable("night") }];
    })) as Record<string, { day: boolean; night: boolean }>;
  }, [calendarDays, maintenanceBlocks, now, reservations]);
  const monthLabel = month.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const today = manilaDateKey(new Date(now));
  const upcomingCount = new Set(calendarEvents.filter(event => event.reservationId && event.date >= today && !["cancelled", "rejected", "completed"].includes(event.status ?? "")).map(event => event.reservationId)).size;
  const attentionCount = new Set(calendarEvents.filter(event => event.flags?.length).map(event => event.reservationId)).size;
  const selectedReservation = reservations.find(row => row.reservation_id === selectedEvent?.reservationId);
  const selectedOcular = ocularVisits.find(visit => visit.visit_id === selectedEvent?.id);
  const checkoutBalance = selectedReservation ? signals[selectedReservation.reservation_id]?.balance : undefined;
  const checkoutBlocked = checkoutBalance === undefined || checkoutBalance > 0 || Boolean(selectedReservation && (signals[selectedReservation.reservation_id]?.payment || signals[selectedReservation.reservation_id]?.reschedule));
  const selectedFlags = selectedReservation ? reservationAttention(selectedReservation, signals[selectedReservation.reservation_id], now) : [];
  const flagCount = (flag: AttentionFlag) => new Set(calendarEvents.filter(event => event.flags?.includes(flag)).map(event => event.reservationId)).size;
  const openEvent = (event: CalendarEvent) => { setSelectedEvent(event); setArrivalConfirmed(false); setDepartureConfirmed(false); setCheckInError(null); };
  const changeMonth = (offset: number) => { const next = new Date(month.getFullYear(), month.getMonth() + offset, 1); setMonth(next); setSelectedDay(dateKey(next)); };
  const recordArrival = async () => {
    if (!selectedReservation || !arrivalConfirmed || attendanceSubmitting.current) return;
    attendanceSubmitting.current = true;
    setCheckInBusy(true); setCheckInError(null);
    try {
      const response = await fetch("/api/admin/reservations/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reservationId: selectedReservation.reservation_id, arrivalConfirmed: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Unable to record check-in.");
      if (payload.reservation) setReservations(rows => rows.map(row => row.reservation_id === payload.reservation.reservation_id ? { ...row, ...payload.reservation } : row));
      setPaymentRevision(value => value + 1);
      setCancellationMessage("Guest check-in recorded. Cancellation and rescheduling are now locked."); setArrivalConfirmed(false); setRefreshKey(key => key + 1);
    } catch (cause) { setCheckInError(cause instanceof Error ? cause.message : "Unable to record check-in."); }
    finally { attendanceSubmitting.current = false; setCheckInBusy(false); }
  };
  const recordDeparture = async () => {
    if (!selectedReservation || !departureConfirmed || checkoutBlocked || attendanceSubmitting.current) return;
    attendanceSubmitting.current = true; setCheckInBusy(true); setCheckInError(null);
    try {
      const response = await fetch("/api/admin/reservations/check-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reservationId: selectedReservation.reservation_id, departureConfirmed: true }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Unable to record checkout.");
      if (payload.reservation) setReservations(rows => rows.map(row => row.reservation_id === payload.reservation.reservation_id ? { ...row, ...payload.reservation } : row));
      setCancellationMessage(payload.message + (payload.notificationSent === false ? " Guest notification could not be delivered." : ""));
      setDepartureConfirmed(false); setPaymentRevision(value => value + 1); setRefreshKey(value => value + 1);
    } catch (cause) { setCheckInError(cause instanceof Error ? cause.message : "Unable to record checkout. Refresh the calendar before retrying."); }
    finally { attendanceSubmitting.current = false; setCheckInBusy(false); }
  };
  const selectedDate = new Date(`${selectedDay}T12:00:00`);
  const weekStart = addDays(selectedDate, -((selectedDate.getDay() + 6) % 7));
  const weekEnd = addDays(weekStart, 7);
  const mobileDays = calendarDays.filter(day => mobileView === "Week"
    ? dateKey(day) >= dateKey(weekStart) && dateKey(day) < dateKey(weekEnd)
    : mobileView === "Month" ? day.getMonth() === month.getMonth() : true)
    .filter(day => (filteredEventsByDay[dateKey(day)] ?? []).length > 0);
  const moveMobilePeriod = (offset: number) => {
    if (mobileView !== "Week") { changeMonth(offset); return; }
    const next = addDays(new Date(`${selectedDay}T12:00:00`), offset * 7);
    setSelectedDay(dateKey(next));
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  };
  const openMaintenance = () => { setBlockError(null); setShowBlockForm(true); };
  const renderEvent = (event: CalendarEvent) => {
    const style = eventStyles[event.kind], reservation = reservations.find(row => row.reservation_id === event.reservationId);
    return <button key={event.id} type="button" onClick={() => openEvent(event)} style={{ backgroundColor: "#f3f4f8" }} className={`block min-h-14 w-full min-w-0 rounded-md border-l-[3px] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${style.className}`}>
      <span className="block text-[10px] font-medium opacity-75">{reservation ? `${formatTime(reservation.start_datetime)} - ${formatTime(reservation.end_datetime)}` : style.label} ? {titleCase(event.status ?? "scheduled")}</span>
      <span className="mt-0.5 block break-words text-xs font-semibold">{event.label}</span>
      <span className="mt-0.5 block break-all text-[10px] opacity-75">{style.label} | {event.reference}</span>
      {!!event.flags?.length && <span className="mt-1 block text-[10px] font-medium text-red-800">! {event.flags.map(flag => ATTENTION_LABELS[flag]).join(" | ")}</span>}
    </button>;
  };
  return <div className="min-w-0 text-neutral">
    <AdminSectionHeader title="Reservations" subtitle="Select a booking to update its details, services and bill." actions={<div className="flex flex-wrap items-center gap-2">
        {canCreate && <button type="button" onClick={() => setIsManualBookingOpen(true)} aria-label="New reservation" title="New reservation" className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white shadow-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d="M8 2v4m8-4v4M3 10h18M11 21H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5M18 14v8m-4-4h8" /></svg>
        </button>}
        {isAdmin && <button type="button" onClick={openMaintenance} aria-label="Add maintenance block" title="Add maintenance block" className="flex h-11 w-11 items-center justify-center rounded-xl border border-primary/30 bg-white text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94L14.7 6.3Z" /></svg>
        </button>}
        <button type="button" disabled={isLoading} onClick={() => setRefreshKey(key => key + 1)} aria-label="Refresh calendar" title="Refresh calendar" className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral/20 bg-white text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-5 w-5 ${isLoading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 19.5 9M17.9 17.9A8 8 0 0 1 4.5 15" /></svg>
        </button>
      </div>} />
    {isLoading && <div className="mb-4"><LoadingState title="Loading reservation calendar..." description="Fetching bookings, maintenance dates and items needing attention." /></div>}
    {cancellationMessage && <p role="status" className="mb-4 rounded-xl bg-green-50 p-4 text-sm text-green-900">{cancellationMessage}</p>}
    {blockMessage && <p role="status" className="mb-4 rounded-xl bg-orange-50 p-4 text-sm">{blockMessage}</p>}
    {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error} {reservations.length > 0 && "Previously loaded data is shown; flags may be out of date."}<button type="button" onClick={() => setRefreshKey(key => key + 1)} className="ml-2 min-h-11 underline">Retry calendar</button></div>}
    {showBlockForm && <RecordDialog variant="admin" title="Add maintenance block" reference="Resort maintenance" busy={blockBusy} onClose={() => { if (!blockBusy) setShowBlockForm(false); }}>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void saveBlock(); }}>
        {blockError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800 sm:col-span-2">{blockError}</p>}
        <label className="text-sm">Name<input required maxLength={120} value={blockName} onChange={event => setBlockName(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 p-2 text-base text-black" /></label>
        <label className="text-sm">Reason / guest announcement<input required maxLength={2000} value={blockReason} onChange={event => setBlockReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 p-2 text-base text-black" /></label>
        <label className="text-sm">Start date<input required type="date" value={blockStart} onChange={event => setBlockStart(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 p-2 text-base text-black" /></label>
        <label className="text-sm">End date<input required type="date" min={blockStart} value={blockEnd} onChange={event => setBlockEnd(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 p-2 text-base text-black" /></label>
        <p className="text-xs text-neutral/60 sm:col-span-2">Dates with active reservations cannot be blocked. Creating a block notifies registered guests.</p>
        <button disabled={blockBusy} className="min-h-11 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2">{blockBusy ? "Creating..." : "Block dates and alert guests"}</button>
      </form>
    </RecordDialog>}
    <div className="hidden gap-4 md:grid md:grid-cols-3">{[{ label: "Upcoming reservations", value: upcomingCount, detail: "In the visible calendar period" }, { label: "Ocular visits", value: ocularVisits.length, detail: "In the visible calendar period" }, { label: "Needs attention", value: attentionCount, detail: "Payments, requests, balances and arrivals" }].map(metric => <div key={metric.label} className="rounded-2xl border border-neutral/10 bg-white p-5 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-neutral/50">{metric.label}</p><p className="mt-2 text-3xl font-semibold text-neutral">{isLoading ? "-" : error ? "-" : metric.value}</p><p className="mt-1 text-xs text-neutral/50">{metric.detail}</p></div>)}</div>
    <section aria-label="Calendar filters" className="my-4 flex flex-wrap items-end gap-3 rounded-2xl border border-neutral/10 bg-white p-4 shadow-sm">
      <label className="min-w-0 flex-1 text-xs font-medium text-neutral/65">Search bookings<input type="search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="Guest or booking reference" className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white px-3 text-base text-black md:text-sm" /></label>
      <label className="min-w-0 flex-1 text-xs font-medium text-neutral/65 md:max-w-xs">Show<select aria-label="Filter calendar entries" value={attentionFilter} onChange={event => setAttentionFilter(event.target.value as typeof attentionFilter)} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white px-3 text-base text-black md:text-sm">
        <option value="all">All entries</option><option value="attention">Needs attention ({attentionCount})</option>{(Object.keys(ATTENTION_LABELS) as AttentionFlag[]).map(flag => <option key={flag} value={flag}>{ATTENTION_LABELS[flag]} ({flagCount(flag)})</option>)}
      </select></label>
    </section>
    <section aria-label="Desktop reservation calendar" aria-busy={isLoading} className="hidden overflow-hidden rounded-2xl border border-neutral/10 bg-white shadow-sm md:block">
      <div className="flex items-center justify-between gap-4 border-b border-neutral/10 p-4"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Month view calendar</p><h2 className="mt-1 text-xl font-semibold text-neutral">{monthLabel}</h2></div><div className="flex gap-2">
        <button type="button" onClick={() => changeMonth(-1)} className="min-h-11 rounded-xl border border-neutral/15 px-3 text-sm hover:bg-base" aria-label="Previous month">&larr;</button>
        <button type="button" onClick={() => { setMonth(new Date(`${today}T12:00:00`)); setSelectedDay(today); }} className="min-h-11 rounded-xl border border-neutral/15 px-3 text-xs font-semibold hover:bg-base">Today</button>
        <button type="button" onClick={() => changeMonth(1)} className="min-h-11 rounded-xl border border-neutral/15 px-3 text-sm hover:bg-base" aria-label="Next month">&rarr;</button>
      </div></div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-neutral/10 px-4 py-3 text-xs text-neutral/70">{Object.entries(eventStyles).map(([kind, style]) => <span key={kind} className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${style.dotClassName}`} />{style.label}</span>)}<span className="font-semibold text-red-700">! Needs attention</span></div>
        <div className="grid grid-cols-7 border-b border-neutral/10 bg-base text-[10px] font-semibold uppercase tracking-wide text-neutral/50">{weekDays.map((day) => <div key={day} className="border-r border-neutral/10 px-2 py-3 last:border-r-0">{day.slice(0, 3)}</div>)}</div>
        <div className="grid grid-cols-7">
          {calendarDays.map((day) => {
            const dayKey = dateKey(day);
            const dayEvents = filteredEventsByDay[dayKey] ?? [];
            const dayReservation = dayEvents.find((event) => event.reservationId && !["cancelled", "rejected"].includes(event.status ?? ""))
              ?? dayEvents.find((event) => event.reservationId);
            const isCurrentMonth = day.getMonth() === month.getMonth();
            const isToday = dayKey === today;
            const availability = availabilityByDay[dayKey];
            const maintenanceBlocked = (eventsByDay[dayKey] ?? []).some((event) => event.kind === "maintenance");
            const availabilityLabel = isLoading ? "Checking availability..." : error ? "Availability unavailable" : maintenanceBlocked ? "Maintenance blocked" : availability?.day && availability?.night ? "Day and night available" : availability?.day ? "Day available · Night booked" : availability?.night ? "Night available · Day booked" : "Fully booked";
            return <div key={dayKey} className={`min-h-28 border-b border-r border-neutral/10 p-2 transition-colors hover:bg-primary/5 ${isCurrentMonth ? "bg-white" : "bg-base/50"}`}>
              {dayReservation ? (
                <button type="button" onClick={() => openEvent(dayReservation)} aria-label={`View reservation details for ${dayKey}`} className={`mb-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary ${isToday ? "bg-neutral text-base" : isCurrentMonth ? "text-neutral" : "text-neutral/30"}`}>{day.getDate()}</button>
              ) : (
                <div className={`mb-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-neutral text-base" : isCurrentMonth ? "text-neutral" : "text-neutral/30"}`}>{day.getDate()}</div>
              )}
              <p className={`mb-1 rounded px-1 py-0.5 text-[10px] font-medium ${isLoading || error ? "bg-neutral/5 text-neutral/60" : availability?.day && availability?.night ? "bg-green-50 text-green-800" : availability?.day || availability?.night ? "bg-amber-50 text-amber-900" : "bg-neutral/10 text-neutral/60"}`} title={availabilityLabel}>{availabilityLabel}</p>
              <div className="space-y-1">
                {dayEvents.map((event) => {
                  const style = eventStyles[event.kind];
                  const reservation = event.reservationId
                    ? reservations.find((item) => item.reservation_id === event.reservationId)
                    : null;
                  const guest = reservation?.guest_id
                    ? guests[reservation.guest_id]
                    : reservation?.walk_in_guest_id
                      ? walkInGuests[reservation.walk_in_guest_id]
                      : null;

                  return (
                    <div key={event.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => openEvent(event)}
                        className={`block w-full truncate rounded-md border-l-2 px-2 py-1 text-left text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-primary ${style.className}`}
                        title={`${style.label}: ${event.label}${event.flags?.length ? `. Needs attention: ${event.flags.map(flag => ATTENTION_LABELS[flag]).join(", ")}` : ""}`}
                      >
                        <span className="block text-[9px] font-normal opacity-75">{style.label}</span>
                        {event.label}{!!event.flags?.length && <span className="ml-1 font-bold text-red-700" aria-label={`${event.flags.length} attention flags`}>!</span>}
                      </button>
                      <div className="invisible absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-neutral/10 bg-white p-3 text-left opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral/50">{style.label}</p>
                        <p className="mt-1 text-sm font-semibold text-neutral">{event.label}</p>
                        {!!event.flags?.length && <p className="mt-2 text-xs text-red-800">{event.flags.map(flag => ATTENTION_LABELS[flag]).join(" ? ")}</p>}
                        {reservation && guest ? (
                          <div className="mt-2 space-y-1 text-xs text-neutral/70">
                            <p>{guest.email ?? "No email provided"}</p>
                            <p>{guest.phone_number ?? "No phone provided"}</p>
                            <p>{reservation.adult_count} adults · {reservation.child_count} children</p>
                            <p>{formatTime(reservation.start_datetime)} - {formatTime(reservation.end_datetime)}</p>
                            <p>Status: {titleCase(reservation.status)}</p>
                          </div>
                        ) : event.kind === "ocular" ? (
                          <p className="mt-2 text-xs text-neutral/70">Status: {titleCase(event.status ?? "pending")}</p>
                        ) : event.kind === "maintenance" ? (
                          <p className="mt-2 text-xs text-neutral/70">Status: {titleCase(event.status ?? "blocked")}</p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>;
          })}
        </div>
    </section>
    <section aria-label="Mobile reservation calendar" aria-busy={isLoading} className="rounded-2xl border border-neutral/10 bg-base/80 p-3 shadow-sm md:hidden">
      <h2 className="px-1 text-sm font-bold">{month.toLocaleDateString("en-PH", { month: "short", year: "numeric" })}</h2>
      <div className="mt-3 flex items-center justify-between gap-1">
        <button type="button" onClick={() => moveMobilePeriod(-1)} aria-label="Previous calendar period" className="flex min-h-11 min-w-9 items-center justify-center rounded-full bg-white text-primary">&lsaquo;</button>
        <div role="group" aria-label="Mobile calendar view" className="flex min-w-0 gap-1">{(["Week", "Month", "Agenda"] as const).map(view => <button key={view} type="button" aria-pressed={mobileView === view} onClick={() => setMobileView(view)} className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-1.5 text-[10px] font-semibold ${mobileView === view ? "border-primary text-primary" : "border-transparent bg-white text-neutral"}`}><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" className="h-3 w-3 shrink-0" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M5 1v4m6-4v4M2 7h12" /></svg>{view}</button>)}</div>
        <button type="button" onClick={() => moveMobilePeriod(1)} aria-label="Next calendar period" className="flex min-h-11 min-w-9 items-center justify-center rounded-full bg-white text-primary">&rsaquo;</button>
      </div>
      <div className="my-3"><button type="button" onClick={() => { setMonth(new Date(`${today}T12:00:00`)); setSelectedDay(today); }} className="min-h-11 px-1 text-xs font-medium text-neutral/65">Today</button></div>
      {mobileView === "Week" && <p className="mb-3 text-xs text-neutral/65">{weekStart.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} - {addDays(weekEnd, -1).toLocaleDateString("en-PH", { month: "short", day: "numeric" })}</p>}
      <div aria-label="Mobile calendar entries" className="space-y-1 rounded-xl bg-white p-1.5">
        {mobileDays.map(day => <section key={dateKey(day)} aria-label={`Bookings for ${dateKey(day)}`} className="rounded-xl p-1">
          <h3 className={`mb-1.5 text-xs font-bold ${dateKey(day) === today ? "text-primary" : "text-neutral"}`}>{day.toLocaleDateString("en-PH", { weekday: "short" })}<span className="ml-2">{mobileView === "Agenda" ? day.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : day.getDate()}</span>{dateKey(day) === today && <span className="ml-2 text-[10px] font-medium">Today</span>}</h3>
          <div className="space-y-1">{(filteredEventsByDay[dateKey(day)] ?? []).map(renderEvent)}</div>
        </section>)}
        {mobileDays.length === 0 && <p role="status" className="p-4 text-xs text-neutral/60">{isLoading ? "Loading bookings..." : "No entries match this period and your filters."}</p>}
      </div>
      <p className="mt-3 text-[10px] text-neutral/50">Philippine time. Tap an entry to view details and actions.</p>
    </section>
    {selectedEvent && <RecordDialog variant="admin" title={`${eventStyles[selectedReservation ? calendarBookingKind(selectedReservation.status) : selectedEvent.kind].label} details`} reference={selectedEvent.reference ?? selectedEvent.label} busy={checkInBusy || editorBusy || blockBusy || paymentBusy || ocularBusy} onClose={() => { if (!checkInBusy && !editorBusy && !blockBusy && !paymentBusy && !ocularBusy) setSelectedEvent(null); }}>
      {selectedEvent.reservationId ? <>
        {!!selectedFlags.length && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"><p className="font-semibold">Needs attention</p><ul className="mt-2 list-disc space-y-1 pl-5">{selectedFlags.map(flag => <li key={flag}>{ATTENTION_LABELS[flag]}{flag === "balance" ? `: ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(signals[selectedEvent.reservationId!]?.balance ?? 0)}` : ""}</li>)}</ul></div>}
        {selectedReservation && <div className="mb-4 rounded-xl border border-neutral/10 p-4 text-sm"><p className="font-semibold">Guest arrival</p><p className="mt-1">{selectedReservation.checked_in_at ? `Checked in: ${new Date(selectedReservation.checked_in_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}` : "Not checked in"}</p>
          {canCheckIn && !selectedReservation.checked_in_at && selectedReservation.status === "confirmed" && manilaDateKey(selectedReservation.start_datetime) === today && Date.parse(selectedReservation.end_datetime) > now && <><label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={arrivalConfirmed} disabled={checkInBusy} onChange={event => setArrivalConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5" />I confirm the guest has arrived at the resort.</label><button type="button" disabled={!arrivalConfirmed || checkInBusy} onClick={() => void recordArrival()} className="mt-3 min-h-11 rounded-xl bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">{checkInBusy ? "Recording arrival..." : "Mark guest checked in"}</button></>}
          {selectedReservation.checked_in_at && !selectedReservation.checked_out_at && <p className="mt-2 text-neutral/65">Cancellation and rescheduling are locked after check-in.</p>}
          {selectedReservation.checked_out_at && <p className="mt-2 font-medium text-secondary">Checked out: {new Date(selectedReservation.checked_out_at).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}. Stay completed.</p>}
          {canCheckIn && selectedReservation.checked_in_at && selectedReservation.status === "confirmed" && !selectedReservation.checked_out_at && <div className="mt-4 border-t border-neutral/10 pt-3">
            {checkoutBlocked && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-amber-900">{checkoutBalance === undefined ? "Refresh the calendar to load the bill before checkout." : checkoutBalance > 0 ? `Settle the remaining balance of ${new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(checkoutBalance)} with verified payments before checkout.` : "Resolve pending payment or reschedule reviews before checkout."}</p>}
            <label className="flex items-start gap-2"><input type="checkbox" checked={departureConfirmed} disabled={checkInBusy || checkoutBlocked} onChange={event => setDepartureConfirmed(event.target.checked)} className="mt-0.5 h-5 w-5" />I confirm the guest is checking out. This will complete the stay.</label>
            <button type="button" disabled={!departureConfirmed || checkoutBlocked || checkInBusy} onClick={() => void recordDeparture()} className="admin-button-primary mt-3">{checkInBusy ? "Recording checkout..." : "Check out and complete stay"}</button>
          </div>}
          {checkInError && <p role="alert" className="mt-3 text-red-800">{checkInError}</p>}
        </div>}
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          {canTransactions && selectedFlags.includes("payment") && <Link className="min-h-11 rounded-xl border px-3 py-3 underline" href="/admin/transactions?tab=payments">Review submitted payments</Link>}
          {canRecords && selectedFlags.includes("reschedule") && <Link className="min-h-11 rounded-xl border px-3 py-3 underline" href="/admin/records?tab=reschedules">Review reschedule requests</Link>}
          {canTransactions && selectedFlags.includes("refund") && <Link className="min-h-11 rounded-xl border px-3 py-3 underline" href="/admin/transactions?tab=refunds">Review pending refunds</Link>}
          {canTransactions && selectedFlags.includes("balance") && <Link className="min-h-11 rounded-xl border px-3 py-3 underline" href="/admin/transactions?tab=ledger">Open payment ledger</Link>}
        </div>
        {canReviewPayments && <ReservationPaymentReview key={selectedEvent.reservationId} reservationId={selectedEvent.reservationId} reference={selectedReservation?.reference_number ?? selectedEvent.reference ?? "Reservation"} onBusyChange={setPaymentBusy} onReviewed={() => { setPaymentRevision(value => value + 1); setRefreshKey(key => key + 1); }} />}
        <ReservationEditor key={`${selectedEvent.reservationId}:${paymentRevision}`} reservationId={selectedEvent.reservationId} onBusyChange={setEditorBusy} onSaved={() => setRefreshKey(key => key + 1)} />
        {canCancel && selectedReservation && !selectedReservation.checked_in_at && !["cancelled", "completed", "expired", "rejected"].includes(selectedReservation.status) && <button type="button" onClick={() => { setCancelId(selectedEvent.reservationId!); setSelectedEvent(null); }} className="mt-5 min-h-11 rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700">Cancel reservation / review refund</button>}
      </> : <div className="space-y-3 text-sm"><p>{selectedEvent.label}</p><p>Date: {selectedEvent.date}</p><p>Status: {titleCase(selectedOcular?.status ?? selectedEvent.status ?? "scheduled")}</p><p>{selectedEvent.reference}</p>{blockError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{blockError}</p>}{selectedOcular && <OcularVisitReview key={selectedOcular.visit_id} visit={selectedOcular} canReview={canReviewOcular} onBusyChange={setOcularBusy} onRefresh={() => setRefreshKey(value => value + 1)} onReviewed={visit => { setOcularVisits(rows => rows.map(row => row.visit_id === visit.visit_id ? { ...row, ...visit } : row)); setRefreshKey(value => value + 1); }} />}{isAdmin && selectedEvent.kind === "maintenance" && <button type="button" disabled={blockBusy} onClick={() => void releaseBlock(selectedEvent.id.split(":")[0])} className="min-h-11 rounded-xl border px-3 py-2">Release block</button>}</div>}
    </RecordDialog>}
    {cancelId && <CancellationDialog staff isAdmin={isAdmin} reservationId={cancelId} onClose={() => setCancelId(null)} onCancelled={result => {
      setCancellationMessage(result.message + (!result.emailSent ? " In-app alerts were recorded; email delivery could not be confirmed." : ""));
      setCancelId(null); setSelectedEvent(null); setRefreshKey(key => key + 1);
    }} />}
    <ManualBookingDialog isOpen={isManualBookingOpen && canCreate} onClose={() => setIsManualBookingOpen(false)} onCreated={() => { setIsManualBookingOpen(false); setRefreshKey(key => key + 1); setCancellationMessage("Manual reservation created. The calendar is refreshing."); }} />
  </div>;
}
