"use client";

import { serviceCount } from "@/lib/booking/service-billing";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import BookingProgress from "@/components/booking/BookingProgress";
import BookingGuide from "@/components/booking/BookingGuide";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { useBookingStore } from "@/lib/stores/booking-store";
import { DOWN_PAYMENT_PERCENT, downPaymentAmount } from "@/lib/booking/payment-policy";
import { buildBookingCostSummary } from "@/lib/booking/summary";
import PolicyAgreement from "@/components/legal/PolicyAgreement";
import BookingPromoDiscount from "@/components/booking/BookingPromoDiscount";
import { requiresFullBookingPayment } from "@/lib/booking/commercial-types";
import PrivatePackageDetails from "@/components/booking/PrivatePackageDetails";

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
  const [legalPolicyVersion, setLegalPolicyVersion] = useState<string | null>(null);
  const [policyReload, setPolicyReload] = useState(0);

  const startDateTime = parseDateTimeString(bookingDraft.startDatetime || null);
  const endDateTime = parseDateTimeString(bookingDraft.endDatetime || null);
  const durationHours = startDateTime && endDateTime && endDateTime > startDateTime
    ? (endDateTime.getTime() - startDateTime.getTime()) / 3_600_000
    : null;

  const hasValidDraft =
    Boolean(bookingDraft.startDatetime) &&
    Boolean(bookingDraft.endDatetime) &&
    bookingDraft.adultCount > 0;

  const isRoomBooking = bookingDraft.commercialType === "room_accommodation";
  const isPublicBooking = bookingDraft.commercialType === "public_swimming";
  const requiresFullPayment = requiresFullBookingPayment(bookingDraft.commercialType);
  const totalGuests = Number(bookingDraft.adultCount || 0) + Number(bookingDraft.childCount || 0);
  const downPayment = requiresFullPayment ? Number(bookingDraft.total || 0) : downPaymentAmount(Number(bookingDraft.total || 0));
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

    if ((!acceptedPolicies || bookingPolicyVersion === null || !legalPolicyVersion) && !isAlreadySaved) {
      setSaveError("Read and agree to the Terms and Conditions and Privacy Policy before saving your booking.");
      return;
    }

    if (isAlreadySaved) {
      setSaveSuccess((bookingDraft.total === 0 ? "Booking confirmed. Your promo covers the bill; no payment is needed." : "Your booking is saved. Continue to payment to secure your reservation."));
      return;
    }

    setSaveError(null);
    setSaveSuccess(null);
    saving.current = true;
    setIsSavingBooking(true);

    try {
      const response = await fetch(isRoomBooking ? "/api/reservations/rooms" : isPublicBooking ? "/api/reservations/public-swimming" : "/api/reservations/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(isRoomBooking ? {
          requestId: bookingDraft.roomRequestId, rooms: bookingDraft.roomSelections,
          firstName: bookingDraft.firstName, lastName: bookingDraft.lastName, phone: bookingDraft.phone, address: bookingDraft.address,
          startDatetime: bookingDraft.startDatetime, endDatetime: bookingDraft.endDatetime, durationHours,
          eligibleGuests: bookingDraft.eligibleGuests ?? 0, promoCode: bookingDraft.promoCode ?? null, expectedTotal: bookingDraft.total,
          selectedServices: bookingDraft.services.map(s => ({ serviceId: s.id, quantity: s.quantity ?? 1 })), specialRequests: bookingDraft.specialRequests,
          acceptedPoliciesVersion: legalPolicyVersion, bookingPolicyVersion,
        } : isPublicBooking ? {
          requestId: bookingDraft.publicRequestId, typeId: bookingDraft.publicSwimmingType?.type_id, pricingVersion: bookingDraft.publicSwimmingType?.pricing_version,
          swimmingRooms: bookingDraft.swimmingRooms ?? [],
          firstName: bookingDraft.firstName, lastName: bookingDraft.lastName, phone: bookingDraft.phone, address: bookingDraft.address,
          startDatetime: bookingDraft.startDatetime, endDatetime: bookingDraft.endDatetime, adultCount: bookingDraft.adultCount, childCount: bookingDraft.childCount,
          eligibleGuests: bookingDraft.eligibleGuests ?? 0, promoCode: bookingDraft.promoCode ?? null, expectedTotal: bookingDraft.total,
          selectedServices: bookingDraft.services.map(s => ({ serviceId: s.id, quantity: s.quantity ?? 1 })), specialRequests: bookingDraft.specialRequests,
          acceptedPoliciesVersion: legalPolicyVersion, bookingPolicyVersion,
        } : {
          swimmingRooms: bookingDraft.swimmingRooms ?? [], expectedTotal: bookingDraft.total,
          promoCode: bookingDraft.promoCode ?? null,
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
          specialRequests: bookingDraft.specialRequests,
          selectedServices: bookingDraft.services.map((service) => ({
            serviceId: service.id,
            quantity: service.quantity ?? 1,
          })),
          acceptedPoliciesVersion: legalPolicyVersion,
          bookingPolicyVersion,
        }),
      });

      const json = (await response.json().catch(() => null)) as
        | {
            success?: boolean;
            code?: string;
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
        if (json?.code === "LEGAL_POLICY_CHANGED") { setAcceptedPolicies(false); setPolicyReload(value => value + 1); }
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
          ? { total: Number(json.reservation.totalAmount), downPayment: requiresFullPayment ? Number(json.reservation.totalAmount) : downPaymentAmount(Number(json.reservation.totalAmount)) }
          : {}),
      });
      setPaymentDeadlineAt(json.reservation.paymentDeadlineAt ?? null);
      setSaveSuccess(Number(json.reservation.totalAmount) === 0 ? "Booking confirmed. Your promo covers the bill; no payment is needed." : "Booking saved successfully. Continue to payment to secure your reservation.");
    } catch {
      setSaveError("Unable to save booking right now. Please try again.");
    } finally {
      saving.current = false;
      setIsSavingBooking(false);
    }
  };

  return (
    <div className="booking-flow min-h-screen bg-base">
      <Navigation />
      <BookingGuide room={isRoomBooking} publicSwimming={isPublicBooking} page="review" saved={isAlreadySaved} disabled={isSavingBooking} />

      <BookingProgress currentStep={3} />

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
                        {requiresFullPayment ? "Full Payment" : `${DOWN_PAYMENT_PERCENT}% Down Payment`}: <span className="font-semibold text-primary">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </p>
                      {requiresFullPayment ? <p className="text-neutral/70">Pay the full amount within 30 minutes after saving your booking.</p> : <p>
                        Remaining Balance: <span className="font-semibold text-neutral">₱{remainingBalance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </p>}
                    </div>
                  </div>

                  <div data-booking-guide="review-details" className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Guest Information</h3>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm text-neutral/80">
                      <p>Name: <span className="font-semibold text-neutral">{bookingDraft.firstName} {bookingDraft.lastName}</span></p>
                      <p>Email: <span className="font-semibold text-neutral">{bookingDraft.email}</span></p>
                      <p>Phone: <span className="font-semibold text-neutral">{bookingDraft.phone}</span></p>
                      <p>Address: <span className="font-semibold text-neutral">{bookingDraft.address || "-"}</span></p>
                    </div>
                  </div>

                  <div data-booking-guide="review-schedule" className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Booking Details</h3>
                    <div className="grid sm:grid-cols-2 gap-2 text-sm text-neutral/80">
                      <p>
                        Start: <span className="font-semibold text-neutral">{startDateTime?.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) || "-"}</span>
                      </p>
                      <p>
                        End: <span className="font-semibold text-neutral">{endDateTime?.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) || "-"}</span>
                      </p>
                      <p>Mode: <span className="font-semibold text-neutral">{isRoomBooking ? "Room accommodation" : bookingDraft.bookingMode === "whole_day" ? bookingDraft.wholeDayVariant === "day_to_night" ? "Whole Day – Daytime" : "Whole Day – Overnight" : { day: "Day", night: "Night", custom: "Custom" }[bookingDraft.bookingMode]}</span></p>
                      {isRoomBooking ? <p>Accommodation: <span className="font-semibold text-neutral">{bookingDraft.roomName}</span></p> : !isPublicBooking && <p>Cottages: <span className="font-semibold text-neutral">All included</span></p>}
                      <p>Duration: <span className="font-semibold text-neutral">{durationHours === null ? "Unavailable" : `${durationHours.toLocaleString("en-PH", { maximumFractionDigits: 2 })} ${durationHours === 1 ? "hr" : "hrs"}`}</span></p>


                      <p>Total Guests: <span className="font-semibold text-neutral">{totalGuests}</span></p>
                    </div>
                  </div>

                  {!isRoomBooking && !isPublicBooking && <PrivatePackageDetails />}
                  {!isRoomBooking && !!bookingDraft.swimmingRooms?.length && <section className="rounded-xl border border-neutral/10 p-4"><h3 className="mb-3 text-lg font-semibold">Additional Rooms</h3><ul className="space-y-2 text-sm">{bookingDraft.swimmingRooms.map(r => <li key={r.classificationId}>{r.name} × {r.quantity} · ₱{(Number(r.unitPrice || 0) * r.quantity).toLocaleString("en-PH", { minimumFractionDigits: 2 })} for the full swimming session</li>)}</ul></section>}
                  {isRoomBooking && <section className="rounded-xl border border-neutral/10 p-4"><h3 className="mb-3 text-lg font-semibold">Selected Rooms</h3><ul className="space-y-2 text-sm">{bookingDraft.roomSelections?.map((r, i) => <li key={i}>Room {i + 1}: {r.name} &middot; {r.occupants} guest(s) &middot; {durationHours} hours</li>)}</ul><p className="mt-3 text-sm">Declared PWD / senior guests: {bookingDraft.eligibleGuests ?? 0}. Bring valid IDs for staff verification at arrival.</p></section>}
                  {isPublicBooking && <section className="rounded-xl border border-neutral/10 p-4"><h3 className="font-semibold">{bookingDraft.publicSwimmingType?.name ?? "Public Swimming"}</h3><p className="mt-2 text-sm">{bookingDraft.adultCount} adults · {bookingDraft.childCount} children · {bookingDraft.eligibleGuests ?? 0} PWD / senior guests. Bring valid IDs for staff verification.</p></section>}
                  <div className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Selected Services</h3>
                    {bookingDraft.services.length === 0 ? (
                      <p className="text-sm text-neutral/70">No additional services selected.</p>
                    ) : (
                      <div className="space-y-1 text-sm text-neutral/80">
                        {bookingDraft.services.map((service) => (
                          <p key={service.id}>
                            {service.name} × {serviceCount(service.quantity ?? 1, service.billingType)} - ₱{(Number(service.price || 0) * (service.quantity ?? 1)).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div data-booking-guide="review-bill" className="rounded-xl border border-neutral/10 p-4">
                    <h3 className="text-lg font-semibold text-neutral mb-3">Billing Breakdown</h3>
                    <div className="space-y-2 text-sm text-neutral/80">
                      <div className="flex justify-between"><span>{costSummary.packageLabel}</span><span className="font-semibold text-neutral">₱{costSummary.packageCharge.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                      {costSummary.extraGuestCharge > 0 && <div className="flex justify-between"><span>Extra guests ({costSummary.extraGuests})</span><span className="font-semibold text-neutral">₱{costSummary.extraGuestCharge.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
                      {costSummary.roomsTotal > 0 && <div className="flex justify-between"><span>Additional rooms</span><span className="font-semibold text-neutral">₱{costSummary.roomsTotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
                      {bookingDraft.services.map((service) => <div key={service.id} className="flex justify-between"><span>{service.name} × {serviceCount(service.quantity ?? 1, service.billingType)}</span><span className="font-semibold text-neutral">₱{(Number(service.price || 0) * (service.quantity ?? 1)).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>)}
                      <div className="flex justify-between"><span>Subtotal</span><span className="font-semibold text-neutral">₱{costSummary.subtotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                      {costSummary.tax > 0 && <div className="flex justify-between"><span>Tax</span><span className="font-semibold text-neutral">₱{costSummary.tax.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
                      <BookingPromoDiscount code={costSummary.promoCode} amount={costSummary.discountAmount} kind={costSummary.discountKind} />
                      <div className="flex justify-between border-t border-neutral/10 pt-2"><span className="font-semibold text-neutral">Total</span><span className="font-bold text-primary">₱{Number(bookingDraft.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                    </div>
                  </div>
                </div>

                {!isAlreadySaved && <div data-booking-guide="review-policies" className="mt-8"><PolicyAgreement accepted={acceptedPolicies} onChange={setAcceptedPolicies} onPolicyVersion={setBookingPolicyVersion} onLegalVersion={setLegalPolicyVersion} reloadKey={policyReload} /></div>}

                {saveError && <div role="alert" className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{saveError}</div>}
                {isAlreadySaved && (
                  <div data-booking-guide="review-saved" role="status" className="mt-6 rounded-xl border border-secondary/30 bg-secondary/10 p-4 text-sm text-neutral">
                    <p className="font-semibold">{saveSuccess ?? (bookingDraft.total === 0 ? "Booking confirmed. Your promo covers the bill; no payment is needed." : "Your booking is saved. Continue to payment to secure your reservation.")}</p>
                    <p className="mt-2">Booking reference: <span className="ui-nowrap font-semibold text-primary">{bookingDraft.reservationReference || "-"}</span></p>
                    {paymentDeadlineAt && <p>Submit payment by {new Date(paymentDeadlineAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Manila time).</p>}
                  </div>
                )}
                <div data-booking-guide="review-actions" aria-label="Booking actions" className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Link href={isAlreadySaved ? requiresFullPayment ? "/manage" : "/" : "/booking/form"} aria-disabled={isSavingBooking} tabIndex={isSavingBooking ? -1 : undefined}
                    onClick={event => { if (saving.current) event.preventDefault(); }}
                    className="flex min-h-12 items-center justify-center rounded-full bg-neutral/10 px-6 py-4 text-center font-semibold text-neutral transition-colors hover:bg-neutral/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-disabled:cursor-not-allowed aria-disabled:opacity-50">
                    {isAlreadySaved ? requiresFullPayment ? "View Saved Bookings" : "Back to Home" : requiresFullPayment ? "Back to Booking Details" : "Back to Edit"}
                  </Link>
                  {isAlreadySaved ? <Link href={bookingDraft.total === 0 ? "/manage" : "/booking/payment"} className="flex min-h-12 items-center justify-center rounded-full bg-primary px-6 py-4 text-center font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
                    {bookingDraft.total === 0 ? "Manage confirmed booking" : "Continue to Payment"}
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
                  <BookingPromoDiscount code={costSummary.promoCode} amount={costSummary.discountAmount} kind={costSummary.discountKind} />
                  <div className="flex justify-between"><span>Total</span><span className="font-semibold text-neutral">₱{Number(bookingDraft.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  {!requiresFullPayment && <>
                  <div className="flex justify-between"><span>{DOWN_PAYMENT_PERCENT}% Down Payment Option</span><span className="font-semibold text-primary">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  <div className="flex justify-between"><span>Balance</span><span className="font-semibold text-neutral">₱{remainingBalance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                  </>}
                </div>

                <div className="mt-6 rounded-lg bg-highlight/10 p-4 text-sm text-neutral/80">
                  Reservation is only created when you click <span className="font-semibold">Save Booking</span>. {requiresFullPayment ? "Public swimming and room accommodation require full payment of the outstanding balance." : "At payment, choose the down payment or the full total."} Payments remain subject to verification and the policy attached to your booking.
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
