"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { useBookingStore } from "@/lib/stores/booking-store";

const parseDateString = (value: string | null) => {
  if (!value) return null;
  const parts = value.split("-");
  if (parts.length !== 3) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!year || !month || !day) return null;

  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function BookingDetailsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-base" />}>
      <BookingDetailsContent />
    </Suspense>
  );
}

function BookingDetailsContent() {
  const bookingDraft = useBookingStore((state) => state.bookingDraft);
  const setBookingDraft = useBookingStore((state) => state.setBookingDraft);

  const [isSavingBooking, setIsSavingBooking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const checkInDate = parseDateString(bookingDraft.checkIn || null);
  const checkOutDate = parseDateString(bookingDraft.checkOut || null);

  const hasValidDraft =
    Boolean(bookingDraft.checkIn) &&
    Boolean(bookingDraft.checkOut) &&
    Boolean(bookingDraft.unitId) &&
    bookingDraft.adultCount > 0;

  const totalGuests = Number(bookingDraft.adultCount || 0) + Number(bookingDraft.childCount || 0);
  const remainingBalance = Math.max(Number(bookingDraft.total || 0) - Number(bookingDraft.downPayment || 0), 0);

  const isAlreadySaved = Boolean(bookingDraft.reservationId);

  const formattedSaveDate = useMemo(() => new Date().toLocaleDateString("en-PH"), []);

  const handleSaveBooking = async () => {
    if (!hasValidDraft) {
      setSaveError("Missing booking details. Please go back to the form.");
      return;
    }

    if (isAlreadySaved) {
      setSaveSuccess("Booking already saved. You can continue to payment or manage booking.");
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    setIsSavingBooking(true);

    try {
      const response = await fetch("/api/reservations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          checkInDate: bookingDraft.checkIn,
          checkOutDate: bookingDraft.checkOut,
          adultCount: bookingDraft.adultCount,
          childCount: bookingDraft.childCount,
          unitId: bookingDraft.unitId,
          specialRequests: bookingDraft.specialRequests,
          selectedServices: bookingDraft.services.map((service) => ({
            serviceId: service.id,
            quantity: 1,
          })),
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
            reservation?: {
              id?: string;
              referenceNumber?: string;
            };
          }
        | null;

      if (!response.ok || !json?.success || !json.reservation?.id) {
        setSaveError(json?.message || "Failed to save booking.");
        setIsSavingBooking(false);
        return;
      }

      setBookingDraft({
        reservationId: json.reservation.id,
        reservationReference: json.reservation.referenceNumber || "",
      });
      setSaveSuccess("Booking saved successfully. You can now continue to payment or go to manage booking.");
    } catch {
      setSaveError("Unable to save booking right now. Please try again.");
    } finally {
      setIsSavingBooking(false);
    }
  };

  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      <div className="mt-20 bg-white border-b border-neutral/10">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">1</div>
              <span className="text-sm font-medium text-neutral">Select Dates</span>
            </div>
            <div className="w-12 h-0.5 bg-primary" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">2</div>
              <span className="text-sm font-medium text-neutral">Guest Details</span>
            </div>
            <div className="w-12 h-0.5 bg-primary" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">3</div>
              <span className="text-sm font-medium text-primary">Review & Save</span>
            </div>
            <div className="w-12 h-0.5 bg-neutral/20" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-neutral/20 text-neutral/50 flex items-center justify-center font-semibold">4</div>
              <span className="text-sm font-medium text-neutral/50">Payment</span>
            </div>
          </div>
        </div>
      </div>

      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl shadow-xl p-8">
                <h2 className="text-3xl font-bold text-neutral mb-2">Full Booking Details</h2>
                <p className="text-neutral/70 mb-8">
                  Review everything below. Save booking first before proceeding to payment.
                </p>

                {!hasValidDraft ? (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                    Booking details are incomplete. Please go back to the booking form.
                  </div>
                ) : null}

                {saveError ? (
                  <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                    {saveError}
                  </div>
                ) : null}

                {saveSuccess ? (
                  <div className="mb-4 rounded-lg border border-secondary/30 bg-secondary/10 px-4 py-3 text-sm text-neutral/80">
                    {saveSuccess}
                  </div>
                ) : null}

                <div className="space-y-6">
                  <div className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">To Pay First</h3>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm">
                      <p>
                        Down Payment: <span className="font-semibold text-primary">₱{Number(bookingDraft.downPayment || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </p>
                      <p>
                        Remaining Balance: <span className="font-semibold text-neutral">₱{remainingBalance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Guest Information</h3>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm text-neutral/80">
                      <p>Name: <span className="font-semibold text-neutral">{bookingDraft.firstName} {bookingDraft.lastName}</span></p>
                      <p>Email: <span className="font-semibold text-neutral">{bookingDraft.email}</span></p>
                      <p>Phone: <span className="font-semibold text-neutral">{bookingDraft.phone}</span></p>
                      <p>Address: <span className="font-semibold text-neutral">{bookingDraft.address || "-"}</span></p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Booking Details</h3>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm text-neutral/80">
                      <p>
                        Check-in: <span className="font-semibold text-neutral">{checkInDate?.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) || "-"}</span>
                      </p>
                      <p>
                        Check-out: <span className="font-semibold text-neutral">{checkOutDate?.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) || "-"}</span>
                      </p>
                      <p>Room: <span className="font-semibold text-neutral">{bookingDraft.roomName}</span></p>
                      <p>Nights: <span className="font-semibold text-neutral">{bookingDraft.nights}</span></p>
                      <p>Adults: <span className="font-semibold text-neutral">{bookingDraft.adultCount}</span></p>
                      <p>Children: <span className="font-semibold text-neutral">{bookingDraft.childCount}</span></p>
                      <p>Total Guests: <span className="font-semibold text-neutral">{totalGuests}</span></p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Selected Services</h3>
                    {bookingDraft.services.length === 0 ? (
                      <p className="text-sm text-neutral/70">No additional services selected.</p>
                    ) : (
                      <div className="space-y-1 text-sm text-neutral/80">
                        {bookingDraft.services.map((service) => (
                          <p key={service.id}>
                            {service.name} - ₱{Number(service.price || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Billing Breakdown</h3>
                    <div className="space-y-2 text-sm text-neutral/80">
                      <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold text-neutral">₱{Number(bookingDraft.subtotal || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                      <div className="flex justify-between"><span>Tax (12%)</span><span className="font-semibold text-neutral">₱{Number(bookingDraft.tax || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                      <div className="flex justify-between border-t border-neutral/10 pt-2"><span className="font-semibold text-neutral">Total</span><span className="font-bold text-primary">₱{Number(bookingDraft.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link href="/booking/form" className="flex-1">
                    <button type="button" className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                      Back to Edit
                    </button>
                  </Link>
                  <button
                    type="button"
                    disabled={!hasValidDraft || isSavingBooking || isAlreadySaved}
                    onClick={handleSaveBooking}
                    className="flex-1 bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isAlreadySaved ? "Booking Saved" : isSavingBooking ? "Saving Booking..." : "Save Booking"}
                  </button>
                </div>

                {isAlreadySaved ? (
                  <div className="mt-4 rounded-lg bg-base px-4 py-3 text-sm text-neutral/80">
                    <p>
                      Booking saved on {formattedSaveDate}. Reference: <span className="font-semibold text-primary">{bookingDraft.reservationReference || "-"}</span>
                    </p>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <Link href="/booking/payment">
                    <button
                      type="button"
                      disabled={!isAlreadySaved}
                      className="w-full bg-secondary text-base px-6 py-4 rounded-full font-semibold hover:bg-secondary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Continue to Payment
                    </button>
                  </Link>
                  <Link href="/manage">
                    <button
                      type="button"
                      disabled={!isAlreadySaved}
                      className="w-full bg-accent text-base px-6 py-4 rounded-full font-semibold hover:bg-accent/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Go to Manage Booking
                    </button>
                  </Link>
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="bg-white rounded-3xl shadow-xl p-8 sticky top-28">
                <h3 className="text-2xl font-bold text-neutral mb-4">Quick Summary</h3>
                <div className="space-y-3 text-sm text-neutral/80">
                  <div className="flex justify-between"><span>Total</span><span className="font-semibold text-neutral">₱{Number(bookingDraft.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span>Pay Now</span><span className="font-semibold text-primary">₱{Number(bookingDraft.downPayment || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span>Balance</span><span className="font-semibold text-neutral">₱{remainingBalance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                </div>

                <div className="mt-6 rounded-lg bg-highlight/10 p-4 text-sm text-neutral/80">
                  Reservation is only created when you click <span className="font-semibold">Save Booking</span>.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
