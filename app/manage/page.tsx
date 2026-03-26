"use client";

import Image from "next/image";
import { useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

type ManageTab = "bookings" | "ocular";
type RecordMode = "view" | "edit" | "reschedule" | "cancel" | null;

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
  scheduledDate: string;
  timeSlot: string;
  status: string;
  notes: string;
}

export default function ManageBooking() {
  const [activeTab, setActiveTab] = useState<ManageTab>("bookings");
  const [recordMode, setRecordMode] = useState<RecordMode>(null);

  const [bookings, setBookings] = useState<BookingRecord[]>([
    {
      id: "b1",
      reference: "SR-ABC12345",
      checkIn: "2026-03-10",
      checkOut: "2026-03-13",
      guests: 2,
      totalAmount: 1799.1,
      status: "Confirmed",
      email: "john.doe@email.com",
      phone: "+1-555-123-4567",
    },
    {
      id: "b2",
      reference: "SR-XYZ78210",
      checkIn: "2026-04-06",
      checkOut: "2026-04-08",
      guests: 4,
      totalAmount: 2450,
      status: "Pending",
      email: "john.doe@email.com",
      phone: "+1-555-123-4567",
    },
  ]);

  const [ocularBookings, setOcularBookings] = useState<OcularRecord[]>([
    {
      id: "o1",
      scheduledDate: "2026-03-08",
      timeSlot: "10:00 AM",
      status: "Confirmed",
      notes: "First ocular visit",
    },
    {
      id: "o2",
      scheduledDate: "2026-04-02",
      timeSlot: "2:00 PM",
      status: "Pending",
      notes: "Requested by guest",
    },
  ]);

  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [selectedOcularId, setSelectedOcularId] = useState<string | null>(null);

  const selectedBooking = bookings.find((item) => item.id === selectedBookingId) ?? null;
  const selectedOcular = ocularBookings.find((item) => item.id === selectedOcularId) ?? null;

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
                      {bookings.map((record) => (
                        <tr key={record.id} className="border-b border-neutral/10 last:border-none">
                          <td className="px-4 py-3 font-semibold text-neutral">{record.reference}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.checkIn}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.checkOut}</td>
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
                                  setSelectedBookingId(record.id);
                                  setRecordMode("cancel");
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
                        Check-in: <span className="font-semibold text-neutral">{selectedBooking.checkIn}</span>
                      </p>
                      <p>
                        Check-out: <span className="font-semibold text-neutral">{selectedBooking.checkOut}</span>
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

                {recordMode === "cancel" && selectedBooking && (
                  <div className="mt-6 rounded-2xl border border-neutral/10 bg-base p-5 space-y-4">
                    <h3 className="text-lg font-semibold text-neutral">Cancel Booking</h3>
                    <p className="text-sm text-neutral/80">
                      You are about to cancel booking <span className="font-semibold text-neutral">{selectedBooking.reference}</span>.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => setRecordMode("view")}
                        className="rounded-full border border-neutral/20 px-6 py-3 font-semibold text-neutral hover:bg-neutral/5"
                      >
                        Keep Booking
                      </button>
                      <button
                        onClick={() => {
                          setBookings((prev) =>
                            prev.map((item) =>
                              item.id === selectedBooking.id ? { ...item, status: "Cancelled" } : item
                            )
                          );
                          setRecordMode("view");
                        }}
                        className="rounded-full bg-primary px-6 py-3 font-semibold text-base hover:bg-primary/90"
                      >
                        Confirm Cancel
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === "ocular" && (
              <>
                <h2 className="text-2xl font-bold text-neutral mb-4">Your Ocular Booking Records</h2>
                <div className="overflow-x-auto rounded-2xl border border-neutral/10">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-neutral/10 bg-base text-neutral/70">
                      <tr>
                        <th className="px-4 py-3 font-medium">Scheduled Date</th>
                        <th className="px-4 py-3 font-medium">Time Slot</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Notes</th>
                        <th className="px-4 py-3 font-medium">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ocularBookings.map((record) => (
                        <tr key={record.id} className="border-b border-neutral/10 last:border-none">
                          <td className="px-4 py-3 text-neutral/80">{record.scheduledDate}</td>
                          <td className="px-4 py-3 text-neutral/80">{record.timeSlot}</td>
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
                        Scheduled Date: <span className="font-semibold text-neutral">{selectedOcular.scheduledDate}</span>
                      </p>
                      <p>
                        Time Slot: <span className="font-semibold text-neutral">{selectedOcular.timeSlot}</span>
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
                          <option>9:00 AM</option>
                          <option>10:00 AM</option>
                          <option>2:00 PM</option>
                          <option>4:00 PM</option>
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

      <Footer />
    </div>
  );
}
