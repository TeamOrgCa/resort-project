"use client";

import Link from "next/link";
import Image from "next/image";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/client";

interface ServiceLineItem {
  id: string;
  name: string;
  price: number;
}

const parseNumber = (value: string | null, fallback = 0) => {
  if (!value) return fallback;
  const numberValue = Number(value);
  return Number.isNaN(numberValue) ? fallback : numberValue;
};

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

const parseServices = (value: string | null): ServiceLineItem[] => {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as ServiceLineItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.name === "string" && typeof item.price === "number");
  } catch {
    return [];
  }
};

export default function Payment() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-base" />}>
      <PaymentContent />
    </Suspense>
  );
}

function PaymentContent() {
  const searchParams = useSearchParams();
  const [paymentMethod, setPaymentMethod] = useState<"bank" | "ewallet">("bank");
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [uploadedProofPath, setUploadedProofPath] = useState<string | null>(null);
  const [reservationReference, setReservationReference] = useState<string | null>(null);
  const bankFileInputRef = useRef<HTMLInputElement | null>(null);
  const ewalletFileInputRef = useRef<HTMLInputElement | null>(null);

  const bookingReference = useMemo(
    () => "SR-" + Math.random().toString(36).substring(2, 10).toUpperCase(),
    []
  );

  const [bankDetails, setBankDetails] = useState({
    accountName: "",
    referenceNumber: "",
    uploadProof: null as File | null,
  });

  const [ewalletDetails, setEwalletDetails] = useState({
    provider: "gcash",
    accountName: "",
    accountNumber: "",
    referenceNumber: "",
    uploadProof: null as File | null,
  });

  const [bankProofPreviewUrl, setBankProofPreviewUrl] = useState<string | null>(null);
  const [ewalletProofPreviewUrl, setEwalletProofPreviewUrl] = useState<string | null>(null);

  const handleBankProofChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;

    if (bankProofPreviewUrl) {
      URL.revokeObjectURL(bankProofPreviewUrl);
    }

    setBankDetails((prev) => ({ ...prev, uploadProof: file }));
    setBankProofPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const handleEwalletProofChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;

    if (ewalletProofPreviewUrl) {
      URL.revokeObjectURL(ewalletProofPreviewUrl);
    }

    setEwalletDetails((prev) => ({ ...prev, uploadProof: file }));
    setEwalletProofPreviewUrl(file ? URL.createObjectURL(file) : null);
  };

  const removeBankProof = () => {
    if (bankProofPreviewUrl) {
      URL.revokeObjectURL(bankProofPreviewUrl);
    }
    setBankProofPreviewUrl(null);
    setBankDetails((prev) => ({ ...prev, uploadProof: null }));
    if (bankFileInputRef.current) {
      bankFileInputRef.current.value = "";
    }
  };

  const removeEwalletProof = () => {
    if (ewalletProofPreviewUrl) {
      URL.revokeObjectURL(ewalletProofPreviewUrl);
    }
    setEwalletProofPreviewUrl(null);
    setEwalletDetails((prev) => ({ ...prev, uploadProof: null }));
    if (ewalletFileInputRef.current) {
      ewalletFileInputRef.current.value = "";
    }
  };

  useEffect(() => {
    return () => {
      if (bankProofPreviewUrl) {
        URL.revokeObjectURL(bankProofPreviewUrl);
      }
    };
  }, [bankProofPreviewUrl]);

  useEffect(() => {
    return () => {
      if (ewalletProofPreviewUrl) {
        URL.revokeObjectURL(ewalletProofPreviewUrl);
      }
    };
  }, [ewalletProofPreviewUrl]);

  const firstName = searchParams.get("firstName") || "Guest";
  const lastName = searchParams.get("lastName") || "";
  const guestName = `${firstName} ${lastName}`.trim();
  const guests = parseNumber(searchParams.get("guests"), 1);

  const checkInDate = parseDateString(searchParams.get("checkIn"));
  const checkOutDate = parseDateString(searchParams.get("checkOut"));
  const unitId = searchParams.get("unitId") || "";

  const roomName = searchParams.get("roomName") || "Selected Room";
  const roomPrice = parseNumber(searchParams.get("roomPrice"), 0);
  const nights = parseNumber(searchParams.get("nights"), 1);

  const subtotal = parseNumber(searchParams.get("subtotal"), 0);
  const tax = parseNumber(searchParams.get("tax"), 0);
  const totalAmount = parseNumber(searchParams.get("total"), 0);
  const downPayment = parseNumber(searchParams.get("downPayment"), totalAmount * 0.3);
  const selectedServices = parseServices(searchParams.get("services"));

  const backToFormHref = {
    pathname: "/booking/form",
    query: {
      checkIn: searchParams.get("checkIn") || "",
      checkOut: searchParams.get("checkOut") || "",
    },
  };

  const handlePaymentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const selectedProof = paymentMethod === "bank" ? bankDetails.uploadProof : ewalletDetails.uploadProof;

    if (!selectedProof) {
      setSubmitError("Please upload payment proof before submitting.");
      return;
    }

    if (!checkInDate || !checkOutDate || !unitId) {
      setSubmitError("Missing reservation details. Please go back and review your booking.");
      return;
    }

    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id ?? "guest";

      const safeFileName = selectedProof.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const uploadPath = `${userId}/${Date.now()}-${safeFileName}`;
      const bucketName = process.env.NEXT_PUBLIC_SUPABASE_PAYMENT_PROOF_BUCKET!;

      const { error: uploadError } = await supabase.storage
        .from(bucketName)
        .upload(uploadPath, selectedProof, {
          cacheControl: "3600",
          upsert: false,
          contentType: selectedProof.type || undefined,
        });

      if (uploadError) {
        setSubmitError(uploadError.message || "Failed to upload payment proof.");
        setIsSubmitting(false);
        return;
      }

      setUploadedProofPath(uploadPath);

      const checkoutResponse = await fetch("/api/reservations/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          checkInDate: searchParams.get("checkIn"),
          checkOutDate: searchParams.get("checkOut"),
          totalGuests: guests,
          unitId,
          selectedServices: selectedServices.map((service) => ({
            serviceId: service.id,
            quantity: 1,
          })),
          payment: {
            method: paymentMethod === "bank" ? "bank_transfer" : "e_wallet",
            type: "downpayment",
            amount: downPayment,
            referenceNumber:
              paymentMethod === "bank"
                ? bankDetails.referenceNumber
                : ewalletDetails.referenceNumber,
            accountName:
              paymentMethod === "bank"
                ? bankDetails.accountName
                : ewalletDetails.accountName,
            accountNumber:
              paymentMethod === "bank"
                ? null
                : ewalletDetails.accountNumber,
            proofPath: uploadPath,
          },
        }),
      });

      const checkoutJson = (await checkoutResponse.json()) as {
        success?: boolean;
        message?: string;
        reservation?: { referenceNumber?: string };
      };

      if (!checkoutResponse.ok || !checkoutJson.success) {
        setSubmitError(checkoutJson.message || "Failed to create reservation checkout.");
        setIsSubmitting(false);
        return;
      }

      setReservationReference(checkoutJson.reservation?.referenceNumber || null);
      setPaymentComplete(true);
    } catch {
      setSubmitError("Unable to process payment right now. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (paymentComplete) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-12 text-center">
          <div className="w-20 h-20 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-neutral mb-4">Payment Submitted!</h1>
          <p className="text-xl text-neutral/70 mb-8">Your reservation is pending admin approval</p>

          <div className="bg-base p-8 rounded-2xl mb-8">
            <h2 className="text-2xl font-bold text-neutral mb-6">Reservation Summary</h2>
            <div className="space-y-4 text-left">
              <div className="flex justify-between pb-3 border-b border-neutral/10">
                <span className="text-neutral/70">Booking Reference</span>
                <span className="font-bold text-primary text-xl">{reservationReference || bookingReference}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Guest Name</span>
                <span className="font-semibold text-neutral">{guestName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Check-in</span>
                <span className="font-semibold text-neutral">
                  {checkInDate?.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Check-out</span>
                <span className="font-semibold text-neutral">
                  {checkOutDate?.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }) || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Room Type</span>
                <span className="font-semibold text-neutral">{roomName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Guests</span>
                <span className="font-semibold text-neutral">{guests} {guests === 1 ? "Guest" : "Guests"}</span>
              </div>
              <div className="flex justify-between pt-3 border-t border-neutral/10">
                <span className="text-neutral/70">Total Amount</span>
                <span className="font-semibold text-neutral">₱{totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Paid (Down Payment)</span>
                <span className="font-semibold text-secondary">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Balance Due at Checkout</span>
                <span className="font-bold text-primary text-lg">₱{(totalAmount - downPayment).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              {uploadedProofPath && (
                <div className="flex justify-between">
                  <span className="text-neutral/70">Proof Upload</span>
                  <span className="font-semibold text-neutral">Saved</span>
                </div>
              )}
            </div>
          </div>

          <div className="bg-accent/10 p-6 rounded-2xl mb-8 text-left">
            <h3 className="font-bold text-neutral mb-3">Important Information</h3>
            <ul className="space-y-2 text-sm text-neutral/80">
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Your proof of payment has been submitted for admin verification
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Reservation status will remain pending until approved by staff
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                You will receive a confirmation email once payment is approved
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Free cancellation available up to 48 hours before check-in
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/" className="flex-1">
              <button className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                Return Home
              </button>
            </Link>
            <Link href="/manage" className="flex-1">
              <button className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105">
                Manage Booking
              </button>
            </Link>
          </div>

          <div className="mt-6">
            <Link href="/ocular" className="text-accent hover:text-accent/80 font-semibold">
              Schedule an Ocular Visit →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      <div className="mt-20 bg-white border-b border-neutral/10">
        <div className="max-w-6xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">✓</div>
              <span className="text-sm font-medium text-neutral">Select Dates</span>
            </div>
            <div className="w-12 h-0.5 bg-primary" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">✓</div>
              <span className="text-sm font-medium text-neutral">Guest Details</span>
            </div>
            <div className="w-12 h-0.5 bg-primary" />
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary text-base flex items-center justify-center font-semibold">3</div>
              <span className="text-sm font-medium text-primary">Payment</span>
            </div>
          </div>
        </div>
      </div>

      <section className="py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <div className="bg-white rounded-3xl shadow-xl p-8">
                <h2 className="text-3xl font-bold text-neutral mb-8">Payment Details</h2>

                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-neutral mb-4">Select Payment Method</h3>
                  <div className="grid md:grid-cols-2 gap-4">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("bank")}
                      className={`p-6 rounded-xl border-2 transition-all ${
                        paymentMethod === "bank"
                          ? "border-primary bg-primary/5"
                          : "border-neutral/20 hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
                          <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-neutral">Bank Transfer</p>
                          <p className="text-sm text-neutral/70">Direct bank deposit</p>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod("ewallet")}
                      className={`p-6 rounded-xl border-2 transition-all ${
                        paymentMethod === "ewallet"
                          ? "border-primary bg-primary/5"
                          : "border-neutral/20 hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-secondary/20 rounded-full flex items-center justify-center">
                          <svg className="w-6 h-6 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="text-left">
                          <p className="font-semibold text-neutral">E-Wallet</p>
                          <p className="text-sm text-neutral/70">GCash, PayMaya, etc.</p>
                        </div>
                      </div>
                    </button>
                  </div>
                </div>

                <form onSubmit={handlePaymentSubmit}>
                  {submitError && (
                    <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                      {submitError}
                    </div>
                  )}

                  {paymentMethod === "bank" && (
                    <div className="mb-8">
                      <h3 className="text-xl font-semibold text-neutral mb-4">Bank Transfer Details</h3>

                      <div className="bg-neutral/5 p-6 rounded-xl mb-6">
                        <h4 className="font-semibold text-neutral mb-3">Transfer to:</h4>
                        <div className="space-y-2 text-sm">
                          <p><span className="text-neutral/70">Bank:</span> <span className="font-semibold">Paradise National Bank</span></p>
                          <p><span className="text-neutral/70">Account Name:</span> <span className="font-semibold">MarVille Resort Complex</span></p>
                          <p><span className="text-neutral/70">Account Number:</span> <span className="font-semibold">1234-5678-9012</span></p>
                          <p><span className="text-neutral/70">Swift Code:</span> <span className="font-semibold">PNBXPHM1</span></p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Account Name *</label>
                          <input
                            type="text"
                            value={bankDetails.accountName}
                            onChange={(e) => setBankDetails({ ...bankDetails, accountName: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Reference Number *</label>
                          <input
                            type="text"
                            value={bankDetails.referenceNumber}
                            onChange={(e) => setBankDetails({ ...bankDetails, referenceNumber: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Upload Proof of Payment *</label>
                          <input
                            ref={bankFileInputRef}
                            type="file"
                            accept="image/*,.pdf"
                            onChange={handleBankProofChange}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                          {bankDetails.uploadProof && (
                            <div className="mt-3 rounded-lg border border-neutral/20 p-3">
                              <p className="text-xs text-neutral/70 mb-2">Selected file: {bankDetails.uploadProof.name}</p>
                              {bankDetails.uploadProof.type.startsWith("image/") && bankProofPreviewUrl ? (
                                <Image
                                  src={bankProofPreviewUrl}
                                  alt="Bank proof preview"
                                  width={800}
                                  height={400}
                                  unoptimized
                                  className="h-72 w-full rounded-md object-contain bg-neutral/5"
                                />
                              ) : bankDetails.uploadProof.type === "application/pdf" && bankProofPreviewUrl ? (
                                <iframe
                                  src={bankProofPreviewUrl}
                                  title="Bank proof preview"
                                  className="h-72 w-full rounded-md border border-neutral/10 bg-white"
                                />
                              ) : (
                                <p className="text-sm text-neutral/80">Preview unavailable for this file type. File is ready for upload.</p>
                              )}
                              <button
                                type="button"
                                onClick={removeBankProof}
                                className="mt-3 rounded-md border border-neutral/20 px-3 py-1 text-xs font-semibold text-neutral hover:bg-neutral/5"
                              >
                                Remove file
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {paymentMethod === "ewallet" && (
                    <div className="mb-8">
                      <h3 className="text-xl font-semibold text-neutral mb-4">E-Wallet Payment</h3>

                      <div className="space-y-4 mb-6">
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Select Provider *</label>
                          <select
                            value={ewalletDetails.provider}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, provider: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                          >
                            <option value="gcash">GCash</option>
                            <option value="paymaya">PayMaya</option>
                            <option value="grabpay">GrabPay</option>
                            <option value="paypal">PayPal</option>
                          </select>
                        </div>
                      </div>

                      <div className="bg-neutral/5 p-6 rounded-xl mb-6">
                        <h4 className="font-semibold text-neutral mb-3">Send payment to:</h4>
                        <div className="space-y-2 text-sm">
                          <p><span className="text-neutral/70">Account Name:</span> <span className="font-semibold">MarVille Resort</span></p>
                          <p><span className="text-neutral/70">Number:</span> <span className="font-semibold">0917-123-4567</span></p>
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Account Name *</label>
                          <input
                            type="text"
                            value={ewalletDetails.accountName}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, accountName: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Your Account Number *</label>
                          <input
                            type="text"
                            value={ewalletDetails.accountNumber}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, accountNumber: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Reference Number *</label>
                          <input
                            type="text"
                            value={ewalletDetails.referenceNumber}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, referenceNumber: e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-neutral/70 mb-2">Upload Proof of Payment *</label>
                          <input
                            ref={ewalletFileInputRef}
                            type="file"
                            accept="image/*,.pdf"
                            onChange={handleEwalletProofChange}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                          {ewalletDetails.uploadProof && (
                            <div className="mt-3 rounded-lg border border-neutral/20 p-3">
                              <p className="text-xs text-neutral/70 mb-2">Selected file: {ewalletDetails.uploadProof.name}</p>
                              {ewalletDetails.uploadProof.type.startsWith("image/") && ewalletProofPreviewUrl ? (
                                <Image
                                  src={ewalletProofPreviewUrl}
                                  alt="E-wallet proof preview"
                                  width={800}
                                  height={400}
                                  unoptimized
                                  className="h-72 w-full rounded-md object-contain bg-neutral/5"
                                />
                              ) : ewalletDetails.uploadProof.type === "application/pdf" && ewalletProofPreviewUrl ? (
                                <iframe
                                  src={ewalletProofPreviewUrl}
                                  title="E-wallet proof preview"
                                  className="h-72 w-full rounded-md border border-neutral/10 bg-white"
                                />
                              ) : (
                                <p className="text-sm text-neutral/80">Preview unavailable for this file type. File is ready for upload.</p>
                              )}
                              <button
                                type="button"
                                onClick={removeEwalletProof}
                                className="mt-3 rounded-md border border-neutral/20 px-3 py-1 text-xs font-semibold text-neutral hover:bg-neutral/5"
                              >
                                Remove file
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-4">
                    <Link href={backToFormHref} className="flex-1">
                      <button type="button" className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                        Back
                      </button>
                    </Link>
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="flex-1 bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      {isSubmitting ? "Processing..." : "Confirm Payment"}
                    </button>
                  </div>
                </form>
              </div>
            </div>

            <div className="lg:col-span-1">
              <div className="bg-white rounded-3xl shadow-xl p-8 sticky top-28">
                <h3 className="text-2xl font-bold text-neutral mb-6">Payment Summary</h3>

                <div className="space-y-4 mb-6">
                  <div className="pb-4 border-b border-neutral/10">
                    <p className="text-sm text-neutral/70 mb-1">Booking Reference</p>
                    <p className="font-mono font-bold text-neutral">{bookingReference}</p>
                  </div>

                  <div className="pb-4 border-b border-neutral/10">
                    <div className="flex justify-between mb-1">
                      <span className="text-neutral/70">Room</span>
                      <span className="font-semibold text-neutral">{roomName}</span>
                    </div>
                    <div className="flex justify-between mb-1">
                      <span className="text-neutral/70">Rate</span>
                      <span className="font-semibold text-neutral">₱{roomPrice.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/night</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral/70">Duration</span>
                      <span className="font-semibold text-neutral">{nights} nights</span>
                    </div>
                  </div>

                  {selectedServices.length > 0 && (
                    <div className="pb-4 border-b border-neutral/10">
                      <p className="text-sm font-semibold text-neutral mb-2">Additional Services</p>
                      {selectedServices.map((service) => (
                        <div key={service.id || service.name} className="flex justify-between text-sm mb-1">
                          <span className="text-neutral/70">{service.name}</span>
                          <span className="text-neutral">₱{service.price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex justify-between">
                    <span className="text-neutral/70">Subtotal</span>
                    <span className="font-semibold text-neutral">₱{subtotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-neutral/70">Tax (12%)</span>
                    <span className="font-semibold text-neutral">₱{tax.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <div className="flex justify-between">
                    <span className="text-neutral/70">Total Amount</span>
                    <span className="font-semibold text-neutral">₱{totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <div className="bg-primary/5 p-4 rounded-lg">
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-neutral">Down Payment (30%)</span>
                      <span className="text-xl font-bold text-primary">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <p className="text-xs text-neutral/60">Required now to confirm booking</p>
                  </div>

                  <div className="flex justify-between pt-4 border-t border-neutral/10">
                    <span className="text-neutral/70">Remaining Balance</span>
                    <span className="font-semibold text-neutral">₱{(totalAmount - downPayment).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <p className="text-xs text-neutral/60">Balance payable upon checkout</p>
                </div>

                <div className="bg-accent/10 p-4 rounded-lg mb-6">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                    <p className="text-sm text-neutral/80">Your reservation will be set to pending and confirmed only after admin verifies your uploaded proof of payment.</p>
                  </div>
                </div>

                <div className="bg-highlight/10 p-4 rounded-lg">
                  <h4 className="font-semibold text-neutral mb-2 text-sm">Cancellation Policy</h4>
                  <p className="text-xs text-neutral/70">Free cancellation up to 48 hours before check-in. Down payment will be fully refunded.</p>
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
