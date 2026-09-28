"use client";

import { useEffect, useMemo, useState } from "react";
import AdminNotifications from "@/components/admin/AdminNotifications";
import ManualBookingDialog from "@/components/admin/ManualBookingDialog";
import { scheduleBlocksRows } from "@/components/admin/content";
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
};

type OcularVisit = {
  visit_id: string;
  reference_number: string;
  guest_id: string;
  scheduled_date: string;
  status: string;
};

type Guest = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone_number: string | null;
};

type WalkInGuest = Omit<Guest, "id"> & { walk_in_guest_id: string };
type EventKind = "reservation" | "ocular" | "maintenance" | "attention";

type CalendarEvent = {
  id: string;
  kind: EventKind;
  date: string;
  label: string;
  reference?: string;
  reservationId?: string;
  status?: string;
};

const weekDays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const eventStyles: Record<EventKind, { label: string; className: string; dotClassName: string }> = {
  reservation: { label: "Reservation", className: "border-primary bg-orange-50 text-primary", dotClassName: "bg-primary" },
  ocular: { label: "Ocular visit", className: "border-teal-600 bg-teal-50 text-teal-800", dotClassName: "bg-teal-600" },
  maintenance: { label: "Maintenance", className: "border-slate-500 bg-slate-100 text-slate-700", dotClassName: "bg-slate-500" },
  attention: { label: "Attention", className: "border-red-500 bg-red-50 text-red-700", dotClassName: "bg-red-500" },
};

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfMonthGrid = (date: Date) => {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
};
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const formatTime = (value: string) => new Date(value).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function ReservationCalendar() {
  const [month, setMonth] = useState(() => new Date());
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [ocularVisits, setOcularVisits] = useState<OcularVisit[]>([]);
  const [guests, setGuests] = useState<Record<string, Guest>>({});
  const [walkInGuests, setWalkInGuests] = useState<Record<string, WalkInGuest>>({});
  const [searchTerm, setSearchTerm] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isManualBookingOpen, setIsManualBookingOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadCalendarData = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const supabase = createClient();
        const [{ data: reservationData, error: reservationError }, { data: ocularData, error: ocularError }] = await Promise.all([
          supabase.from("reservations").select("reservation_id, reference_number, guest_id, walk_in_guest_id, start_datetime, end_datetime, adult_count, child_count, status").order("start_datetime", { ascending: true }).limit(300),
          supabase.from("ocular_visits").select("visit_id, reference_number, guest_id, scheduled_date, status").order("scheduled_date", { ascending: true }).limit(300),
        ]);

        if (reservationError || ocularError) throw reservationError ?? ocularError;

        const reservationRows = (reservationData as Reservation[] | null) ?? [];
        const ocularRows = (ocularData as OcularVisit[] | null) ?? [];
        const guestIds = [...new Set([...reservationRows.map((row) => row.guest_id), ...ocularRows.map((row) => row.guest_id)].filter((id): id is string => Boolean(id)))];
        const walkInIds = [...new Set(reservationRows.map((row) => row.walk_in_guest_id).filter((id): id is string => Boolean(id)))];
        const [{ data: guestData, error: guestError }, { data: walkInData, error: walkInError }] = await Promise.all([
          guestIds.length ? supabase.from("guests").select("id, first_name, last_name, email, phone_number").in("id", guestIds) : Promise.resolve({ data: [], error: null }),
          walkInIds.length ? supabase.from("walk_in_guests").select("walk_in_guest_id, first_name, last_name, email, phone_number").in("walk_in_guest_id", walkInIds) : Promise.resolve({ data: [], error: null }),
        ]);

        if (guestError || walkInError) throw guestError ?? walkInError;
        if (!mounted) return;

        setReservations(reservationRows);
        setOcularVisits(ocularRows);
        setGuests(((guestData as Guest[] | null) ?? []).reduce<Record<string, Guest>>((map, guest) => ({ ...map, [guest.id]: guest }), {}));
        setWalkInGuests(((walkInData as WalkInGuest[] | null) ?? []).reduce<Record<string, WalkInGuest>>((map, guest) => ({ ...map, [guest.walk_in_guest_id]: guest }), {}));
      } catch {
        if (mounted) setError("Failed to load the reservation calendar.");
      } finally {
        if (mounted) setIsLoading(false);
      }
    };

    void loadCalendarData();
    return () => {
      mounted = false;
    };
  }, []);

  const calendarEvents = useMemo<CalendarEvent[]>(() => {
    const reservationEvents = reservations.map((reservation) => {
      const guest = reservation.guest_id ? guests[reservation.guest_id] : reservation.walk_in_guest_id ? walkInGuests[reservation.walk_in_guest_id] : null;
      const isAttention = reservation.status === "pending" || reservation.status === "reschedule_requested";
      return {
        id: reservation.reservation_id,
        kind: isAttention ? "attention" : "reservation",
        date: dateKey(new Date(reservation.start_datetime)),
        label: guest ? `${guest.first_name} ${guest.last_name}` : reservation.reference_number,
        reference: reservation.reference_number,
        reservationId: reservation.reservation_id,
        status: reservation.status,
      } satisfies CalendarEvent;
    });
    const ocularEvents = ocularVisits.map((visit) => ({
      id: visit.visit_id,
      kind: "ocular" as const,
      date: visit.scheduled_date,
      label: `Ocular visit · ${visit.reference_number}`,
      reference: visit.reference_number,
      status: visit.status,
    }));
    const maintenanceEvents = scheduleBlocksRows.filter((row) => row.type === "Maintenance").map((row) => ({
      id: String(row.id),
      kind: "maintenance" as const,
      date: row.date ?? "",
      label: row.reason ?? "Maintenance",
      status: row.status,
    }));
    return [...reservationEvents, ...ocularEvents, ...maintenanceEvents].filter((event) => event.date);
  }, [guests, ocularVisits, reservations, walkInGuests]);

  const eventsByDay = useMemo(() => calendarEvents.reduce<Record<string, CalendarEvent[]>>((map, event) => {
    map[event.date] = [...(map[event.date] ?? []), event];
    return map;
  }, {}), [calendarEvents]);
  const filteredEventsByDay = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (!normalizedSearch) return eventsByDay;

    return Object.entries(eventsByDay).reduce<Record<string, CalendarEvent[]>>((map, [date, events]) => {
      const matchingEvents = events.filter((event) =>
        `${event.label} ${event.reference ?? ""} ${eventStyles[event.kind].label}`.toLowerCase().includes(normalizedSearch)
      );
      if (matchingEvents.length) map[date] = matchingEvents;
      return map;
    }, {});
  }, [eventsByDay, searchTerm]);
  const calendarDays = useMemo(() => {
    const start = startOfMonthGrid(month);
    return Array.from({ length: 42 }, (_, index) => addDays(start, index));
  }, [month]);
  const monthLabel = month.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
  const upcomingCount = reservations.filter((reservation) => new Date(reservation.start_datetime) >= new Date() && reservation.status !== "cancelled").length;
  const attentionCount = calendarEvents.filter((event) => event.kind === "attention").length;

  return (
    <div>
      <header className="mb-6 flex flex-col gap-4 border-b border-neutral/10 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-neutral md:text-3xl">Reservations</h1>
          <p className="mt-1 text-sm text-neutral/60">Plan the resort schedule and inspect every guest booking.</p>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-start">
          {isSearchOpen ? (
            <input
              autoFocus
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search calendar"
              aria-label="Search calendar"
              className="w-44 rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral outline-none focus:border-primary"
            />
          ) : null}
          <button type="button" onClick={() => setIsSearchOpen((current) => !current)} className="rounded-full border border-neutral/20 bg-white p-2 text-neutral hover:bg-base" aria-label="Search reservations" title="Search reservations">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" strokeWidth="2" /><path strokeLinecap="round" strokeWidth="2" d="m16 16 4 4" /></svg>
          </button>
          <AdminNotifications />
          <button type="button" onClick={() => setIsManualBookingOpen(true)} className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-base shadow-sm hover:bg-primary/90">+ New Reservation</button>
        </div>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Upcoming reservations", value: upcomingCount, detail: "Across all booking dates" },
          { label: "Ocular visits", value: ocularVisits.length, detail: "Scheduled guest visits" },
          { label: "Needs attention", value: attentionCount, detail: "Pending or reschedule requests" },
        ].map((metric) => (
          <div key={metric.label} className="rounded-2xl border border-neutral/10 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral/50">{metric.label}</p>
            <p className="mt-2 text-3xl font-semibold text-neutral">{isLoading ? "-" : metric.value}</p>
            <p className="mt-1 text-xs text-neutral/50">{metric.detail}</p>
          </div>
        ))}
      </div>

      {error ? <p className="mt-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">{error}</p> : null}

      <section className="mt-6 overflow-hidden rounded-2xl border border-neutral/10 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-neutral/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Month view calendar</p><h2 className="mt-1 text-xl font-semibold text-neutral">{monthLabel}</h2></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} className="rounded-lg border border-neutral/15 px-3 py-2 text-sm text-neutral hover:bg-base" aria-label="Previous month">←</button>
            <button type="button" onClick={() => setMonth(new Date())} className="rounded-lg border border-neutral/15 px-3 py-2 text-xs font-semibold text-neutral hover:bg-base">Today</button>
            <button type="button" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} className="rounded-lg border border-neutral/15 px-3 py-2 text-sm text-neutral hover:bg-base" aria-label="Next month">→</button>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-neutral/10 px-4 py-3 text-xs text-neutral/70">
          {(Object.entries(eventStyles) as Array<[EventKind, (typeof eventStyles)[EventKind]]>).map(([kind, style]) => <span key={kind} className="inline-flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${style.dotClassName}`} />{style.label}</span>)}
        </div>

        <div className="grid grid-cols-7 border-b border-neutral/10 bg-base text-[10px] font-semibold uppercase tracking-wide text-neutral/50">{weekDays.map((day) => <div key={day} className="border-r border-neutral/10 px-2 py-3 last:border-r-0">{day.slice(0, 3)}</div>)}</div>
        <div className="grid grid-cols-7">
          {calendarDays.map((day) => {
            const dayKey = dateKey(day);
            const dayEvents = filteredEventsByDay[dayKey] ?? [];
            const isCurrentMonth = day.getMonth() === month.getMonth();
            const isToday = dateKey(day) === dateKey(new Date());
            return <div key={dayKey} className={`min-h-28 border-b border-r border-neutral/10 p-2 transition-colors hover:bg-primary/5 ${isCurrentMonth ? "bg-white" : "bg-base/50"}`}>
              <div className={`mb-2 flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-neutral text-base" : isCurrentMonth ? "text-neutral" : "text-neutral/30"}`}>{day.getDate()}</div>
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
                        className={`block w-full truncate rounded-md border-l-2 px-2 py-1 text-left text-[11px] font-semibold ${style.className}`}
                        title={`${style.label}: ${event.label}`}
                      >
                        {event.label}
                      </button>
                      <div className="invisible absolute left-0 top-full z-30 mt-1 w-64 rounded-xl border border-neutral/10 bg-white p-3 text-left opacity-0 shadow-xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral/50">{style.label}</p>
                        <p className="mt-1 text-sm font-semibold text-neutral">{event.label}</p>
                        {reservation && guest ? (
                          <div className="mt-2 space-y-1 text-xs text-neutral/70">
                            <p>{guest.email ?? "No email provided"}</p>
                            <p>{guest.phone_number ?? "No phone provided"}</p>
                            <p>{reservation.adult_count} adults · {reservation.child_count} children</p>
                            <p>{formatTime(reservation.start_datetime)} - {formatTime(reservation.end_datetime)}</p>
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

      <ManualBookingDialog
        isOpen={isManualBookingOpen}
        onClose={() => setIsManualBookingOpen(false)}
        onCreated={() => {
          setIsManualBookingOpen(false);
          window.location.reload();
        }}
      />
    </div>
  );
}
