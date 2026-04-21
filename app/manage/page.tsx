"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import ConfirmationDialog from "@/components/ui/ConfirmationDialog";
import { createClient } from "@/lib/supabase/client";

type ManageTab = "bookings" | "ocular";
type RecordMode = "view" | "edit" | "reschedule" | null;

interface BookingRecord {
  id: string;
  reference: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  totalAmount: number;
  status: string;
  email: string;
  phone: string;
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
  check_in_date: string;
  check_out_date: string;
  total_guests: number;
  status: string;
}

interface TransactionRow {
  reservation_id: string;
  total_amount: number;
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

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
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

export default function ManageBooking() {
  const [activeTab, setActiveTab] = useState<ManageTab>("bookings");
  const [recordMode, setRecordMode] = useState<RecordMode>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [isCancellingBooking, setIsCancellingBooking] = useState(false);
  const [pendingCancellation, setPendingCancellation] = useState<{ id: string; reference: string; checkIn: string } | null>(null);

  const [bookings, setBookings] = useState<BookingRecord[]>([]);

  const [ocularBookings, setOcularBookings] = useState<OcularRecord[]>([]);

  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedOcularId, setSelectedOcularId] = useState<string | null>(null);

  const selectedBooking = bookings.find((item) => item.id === selectedBookingId) ?? null;
  const selectedOcular = ocularBookings.find((item) => item.id === selectedOcularId) ?? null;

  const getDaysBeforeCheckIn = (checkInDate: string) => {
    const checkIn = new Date(`${checkInDate}T00:00:00`);
    if (Number.isNaN(checkIn.getTime())) return 0;

    const now = new Date();
    const dayMs = 24 * 60 * 60 * 1000;
    return (checkIn.getTime() - now.getTime()) / dayMs;
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
            .select("reservation_id, reference_number, check_in_date, check_out_date, total_guests, status")
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

        const { data: transactionRows, error: transactionsError } = reservationIds.length
          ? await supabase
              .from("transactions")
              .select("reservation_id, total_amount")
              .in("reservation_id", reservationIds)
          : { data: [], error: null };

        if (transactionsError) {
          throw transactionsError;
        }

        if (!isMounted) return;

        const guestData = guestResult.data;
        const transactionByReservationId = ((transactionRows as TransactionRow[] | null) ?? []).reduce<
          Record<string, number>
        >((accumulator, transaction) => {
          accumulator[transaction.reservation_id] = Number(transaction.total_amount ?? 0);
          return accumulator;
        }, {});

        const mappedBookings: BookingRecord[] = reservationRows.map((reservation) => ({
          id: reservation.reservation_id,
          reference: reservation.reference_number,
          checkIn: reservation.check_in_date,
          checkOut: reservation.check_out_date,
          guests: reservation.total_guests,
          totalAmount: transactionByReservationId[reservation.reservation_id] ?? 0,
          status: toTitleCase(reservation.status),
          email: guestData?.email ?? user.email ?? "-",
          phone: guestData?.phone_number ?? "-",
        }));

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
                          <td className="px-4 py-3 text-neutral/80">{formatDate(record.checkIn)}</td>
                          <td className="px-4 py-3 text-neutral/80">{formatDate(record.checkOut)}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.guests}</td>
                          <td className="px-4 py-3 text-neutral/80">₱{record.totalAmount.toFixed(2)}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.status}</td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSelectedBookingId(record.id);
                                  setRecordMode("view");
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                View
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedBookingId(record.id);
                                  setRecordMode("edit");
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => {
                                  setSelectedBookingId(record.id);
                                  setRecordMode("reschedule");
                                }}
                                className="rounded-md border border-neutral/20 px-3 py-1 text-xs font-medium text-neutral hover:bg-base"
                              >
                                Resched
                              </button>
                              <button
                                onClick={() => {
                                  setCancelError(null);

                                  if (record.status.toLowerCase() === "cancelled") {
                                    setCancelError("This reservation is already cancelled.");
                                    return;
                                  }

                                  if (getDaysBeforeCheckIn(record.checkIn) < 2) {
                                    setCancelError("Cancellation is only allowed at least 2 days before check-in.");
                                    return;
                                  }

                                  setPendingCancellation({
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
                        Check-in: <span className="font-semibold text-neutral">{formatDate(selectedBooking.checkIn)}</span>
                      </p>
                      <p>
                        Check-out: <span className="font-semibold text-neutral">{formatDate(selectedBooking.checkOut)}</span>
                      </p>
                      <p>
                        Guests: <span className="font-semibold text-neutral">{selectedBooking.guests}</span>
                      </p>
                      <p>
                        Total Amount: <span className="font-semibold text-neutral">₱{selectedBooking.totalAmount.toFixed(2)}</span>
                      </p>
                    </div>
                  </div>
                )}

                {recordMode === "edit" && selectedBooking && (
                  <form
                    className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5 space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setRecordMode("view");
                    }}
                  >
                    <h3 className="text-lg font-semibold text-neutral">Edit Booking</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm text-neutral/70">Email</label>
                        <input
                          value={selectedBooking.email}
                          onChange={(event) =>
                            setBookings((prev) =>
                              prev.map((item) =>
                                item.id === selectedBooking.id ? { ...item, email: event.target.value } : item
                              )
                            )
                          }
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-neutral/70">Phone</label>
                        <input
                          value={selectedBooking.phone}
                          onChange={(event) =>
                            setBookings((prev) =>
                              prev.map((item) =>
                                item.id === selectedBooking.id ? { ...item, phone: event.target.value } : item
                              )
                            )
                          }
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        />
                      </div>
                    </div>
                    <button className="rounded-full bg-primary px-6 py-3 font-semibold text-base hover:bg-primary/90">
                      Save Changes
                    </button>
                  </form>
                )}

                {recordMode === "reschedule" && selectedBooking && (
                  <form
                    className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5 space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setRecordMode("view");
                    }}
                  >
                    <h3 className="text-lg font-semibold text-neutral">Reschedule Booking</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm text-neutral/70">Check-in</label>
                        <input
                          type="date"
                          value={selectedBooking.checkIn}
                          onChange={(event) =>
                            setBookings((prev) =>
                              prev.map((item) =>
                                item.id === selectedBooking.id ? { ...item, checkIn: event.target.value } : item
                              )
                            )
                          }
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-neutral/70">Check-out</label>
                        <input
                          type="date"
                          value={selectedBooking.checkOut}
                          onChange={(event) =>
                            setBookings((prev) =>
                              prev.map((item) =>
                                item.id === selectedBooking.id ? { ...item, checkOut: event.target.value } : item
                              )
                            )
                          }
                          className="w-full rounded-lg border border-neutral/20 px-3 py-2"
                        />
                      </div>
                    </div>
                    <button className="rounded-full bg-primary px-6 py-3 font-semibold text-base hover:bg-primary/90">
                      Save New Dates
                    </button>
                  </form>
                )}

              </>
            )}

            {activeTab === "ocular" && (
              <>
                <h2 className="text-2xl font-bold text-neutral mb-4">Your Ocular Booking Records</h2>
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

      <Footer />
    </div>
  );
}
