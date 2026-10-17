"use client";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { useBookingStore } from "@/lib/stores/booking-store";
import { DOWN_PAYMENT_PERCENT, downPaymentAmount } from "@/lib/booking/payment-policy";
import { buildBookingCostSummary } from "@/lib/booking/summary";
import PolicyAgreement from "@/components/legal/PolicyAgreement";
import { LEGAL_POLICY_VERSION } from "@/lib/legal/policies";

const parseDateTimeString = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
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
  const saving = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [paymentDeadlineAt, setPaymentDeadlineAt] = useState<string | null>(null);
  const [acceptedPolicies, setAcceptedPolicies] = useState(false);
  const [bookingPolicyVersion, setBookingPolicyVersion] = useState<number | null>(null);

  const startDateTime = parseDateTimeString(bookingDraft.startDatetime || null);
  const endDateTime = parseDateTimeString(bookingDraft.endDatetime || null);

  const hasValidDraft =
    Boolean(bookingDraft.startDatetime) &&
    Boolean(bookingDraft.endDatetime) &&
    Boolean(bookingDraft.unitId) &&
    bookingDraft.adultCount > 0;

  const totalGuests = Number(bookingDraft.adultCount || 0) + Number(bookingDraft.childCount || 0);
  const downPayment = downPaymentAmount(Number(bookingDraft.total || 0));
  const remainingBalance = Math.max(Number(bookingDraft.total || 0) - downPayment, 0);
  const costSummary = buildBookingCostSummary(bookingDraft);

   // FIXED ghost saved state
  const isAlreadySaved =
    typeof bookingDraft.reservationId === "string" &&
    bookingDraft.reservationId.trim() !== "";

  const handleSaveBooking = async () => {
    if (saving.current) return;
    if (!hasValidDraft) {
      setSaveError("Missing booking details. Please go back to the form.");
      return;
    }

    if ((!acceptedPolicies || bookingPolicyVersion === null) && !isAlreadySaved) {
      setSaveError("Read and agree to the Terms and Conditions and Privacy Policy before saving your booking.");
      return;
    }

    if (isAlreadySaved) {
      setSaveSuccess("Your booking is saved. Continue to payment to secure your reservation.");
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    saving.current = true;
    setIsSavingBooking(true);

    try {
      const response = await fetch("/api/reservations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingMode: bookingDraft.bookingMode,
          packageRateVersion: bookingDraft.packageRateVersion,
          phoneNumber: bookingDraft.phone,
          startDatetime: bookingDraft.startDatetime,
          endDatetime: bookingDraft.endDatetime,
          wholeDayVariant: bookingDraft.wholeDayVariant,
          customStartTime: bookingDraft.customStartTime,
          customEndTime: bookingDraft.customEndTime,
          adultCount: bookingDraft.adultCount,
          childCount: bookingDraft.childCount,
          unitId: bookingDraft.unitId,
          specialRequests: bookingDraft.specialRequests,
          selectedServices: bookingDraft.services.map((service) => ({
            serviceId: service.id,
            quantity: 1,
          })),
          acceptedPoliciesVersion: LEGAL_POLICY_VERSION,
          bookingPolicyVersion,
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            message?: string;
            reservation?: {
              id?: string;
              referenceNumber?: string;
              totalAmount?: number;
              paymentDeadlineAt?: string | null;
            };
          }
        | null;

      if (!response.ok || !json?.success || !json.reservation?.id) {
        setSaveError(json?.message || "Failed to save booking.");
        setIsSavingBooking(false);
        return;
      }

     
      // ✅ Save only after success
      setBookingDraft({
        reservationId: json.reservation.id,
        reservationReference:
          json.reservation.referenceNumber || "",
        ...(Number.isFinite(json.reservation.totalAmount)
          ? { total: Number(json.reservation.totalAmount), downPayment: downPaymentAmount(Number(json.reservation.totalAmount)) }
          : {}),
      });
      setPaymentDeadlineAt(json.reservation.paymentDeadlineAt ?? null);
      setSaveSuccess("Booking saved successfully. Continue to payment to secure your reservation.");
    } catch {
      setSaveError("Unable to save booking right now. Please try again.");
    } finally {
      saving.current = false;
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
              <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-8">
                <h2 className="text-3xl font-bold text-neutral mb-2">Full Booking Details</h2>
                <p className="text-neutral/70 mb-8">
                  Review everything below. Save booking first before proceeding to payment.
                </p>

                {!hasValidDraft ? (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                    Booking details are incomplete. Please go back to the booking form.
                  </div>
                ) : null}

                <div className="space-y-6">
                  <div className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">To Pay First</h3>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm">
                      <p>
                        {DOWN_PAYMENT_PERCENT}% Down Payment: <span className="font-semibold text-primary">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                        Start: <span className="font-semibold text-neutral">{startDateTime?.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) || "-"}</span>
                      </p>
                      <p>
                        End: <span className="font-semibold text-neutral">{endDateTime?.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) || "-"}</span>
                      </p>
                      <p>Mode: <span className="font-semibold text-neutral">{bookingDraft.bookingMode === "whole_day" ? `Whole-Day (${bookingDraft.wholeDayVariant === "day_to_night" ? "Variant A" : "Variant B"})` : bookingDraft.bookingMode.replace("_", " ")}</span></p>
                      <p>Room: <span className="font-semibold text-neutral">{bookingDraft.roomName}</span></p>
                      <p>Duration: <span className="font-semibold text-neutral">{bookingDraft.customDurationHours || bookingDraft.nights} {bookingDraft.bookingMode === "custom" ? "hours" : "day(s)"}</span></p>
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
                      <div className="flex justify-between"><span>{costSummary.packageLabel}</span><span className="font-semibold text-neutral">₱{costSummary.packageCharge.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                      {costSummary.extraGuestCharge > 0 && <div className="flex justify-between"><span>Extra guests ({costSummary.extraGuests})</span><span className="font-semibold text-neutral">₱{costSummary.extraGuestCharge.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
                      {bookingDraft.services.map((service) => <div key={service.id} className="flex justify-between"><span>{service.name}</span><span className="font-semibold text-neutral">₱{Number(service.price || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>)}
                      <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold text-neutral">₱{costSummary.subtotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                      {costSummary.tax > 0 && <div className="flex justify-between"><span>Tax</span><span className="font-semibold text-neutral">₱{costSummary.tax.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
                      <div className="flex justify-between border-t border-neutral/10 pt-2"><span className="font-semibold text-neutral">Total</span><span className="font-bold text-primary">₱{Number(bookingDraft.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </div>

                {!isAlreadySaved && <div className="mt-8"><PolicyAgreement accepted={acceptedPolicies} onChange={setAcceptedPolicies} onPolicyVersion={setBookingPolicyVersion} /></div>}

                {saveError && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{saveError}</div>}
                {isAlreadySaved && (
                  <div role="status" className="mt-6 rounded-xl border border-secondary/30 bg-secondary/10 p-4 text-sm text-neutral">
                    <p className="font-semibold">{saveSuccess ?? "Your booking is saved. Continue to payment to secure your reservation."}</p>
                    <p className="mt-2">Booking reference: <span className="break-all font-semibold text-primary">{bookingDraft.reservationReference || "-"}</span></p>
                    {paymentDeadlineAt && <p>Submit payment by {new Date(paymentDeadlineAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Manila time).</p>}
                  </div>
                )}
                <div aria-label="Booking actions" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Link href={isAlreadySaved ? "/" : "/booking/form"} aria-disabled={isSavingBooking} tabIndex={isSavingBooking ? -1 : undefined}
                    onClick={event => { if (saving.current) event.preventDefault(); }}
                    className="flex min-h-12 items-center justify-center rounded-full bg-neutral/10 px-6 py-4 text-center font-semibold text-neutral transition-colors hover:bg-neutral/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
                    {isAlreadySaved ? "Back to Home" : "Back to Edit"}
                  </Link>
                  {isAlreadySaved ? <Link href="/booking/payment" className="flex min-h-12 items-center justify-center rounded-full bg-primary px-6 py-4 text-center font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                    Continue to Payment
                  </Link> : <button type="button" disabled={!hasValidDraft || !acceptedPolicies || bookingPolicyVersion === null || isSavingBooking}
                    onClick={() => void handleSaveBooking()}
                    className="min-h-12 rounded-full bg-primary px-6 py-4 font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                    {isSavingBooking ? "Saving Booking..." : "Save Booking"}
                  </button>}
                </div>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="bg-white rounded-3xl shadow-xl booking-summary p-4 sm:p-8 lg:sticky lg:top-28">
                <h3 className="text-2xl font-bold text-neutral mb-4">Quick Summary</h3>
                <div className="space-y-3 text-sm text-neutral/80">
                  <div className="flex justify-between"><span>Total</span><span className="font-semibold text-neutral">₱{Number(bookingDraft.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span>{DOWN_PAYMENT_PERCENT}% Down Payment Option</span><span className="font-semibold text-primary">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span>Balance</span><span className="font-semibold text-neutral">₱{remainingBalance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                </div>

                <div className="mt-6 rounded-lg bg-highlight/10 p-4 text-sm text-neutral/80">
                  Reservation is only created when you click <span className="font-semibold">Save Booking</span>. At payment, choose the down payment or the full total. Payments remain subject to verification and the policy attached to your booking.
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
