"use client";

import BookingGuide from "@/components/booking/BookingGuide";
import BookingProgress from "@/components/booking/BookingProgress";
import Link from "next/link";
import Image from "next/image";
import { Suspense, useEffect, useRef, useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { createClient } from "@/lib/supabase/client";
import { useBookingStore } from "@/lib/stores/booking-store";
import { DOWN_PAYMENT_PERCENT, downPaymentAmount, resolvePaymentType, amountMeetsMinimum } from "@/lib/booking/payment-policy";
import { isCashMethod, normalizeManualPaymentReference, isValidManualAccountIdentifier } from "@/lib/booking/payment-method";
import { isGcashMethod, normalizeGcashReference } from "@/lib/booking/gcash-receipt";
import { buildBookingCostSummary } from "@/lib/booking/summary";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";
import { isValidAccountNumber, sanitizeAccountNumber } from "@/lib/helper/validation";
import PolicyAgreement from "@/components/legal/PolicyAgreement";
import PaymentQr from "@/components/PaymentQr";
import PaymentErrorAlert from "@/components/booking/PaymentErrorAlert";
import { normalizeSenderName, sanitizeSenderName, SENDER_NAME_ERROR } from "@/lib/validation/sender-name";

const proofInputClass = "block w-full min-w-0 cursor-pointer rounded-xl border border-primary/25 bg-white p-2 text-sm text-neutral file:mr-3 file:min-h-12 file:cursor-pointer file:rounded-lg file:border-0 file:bg-primary file:px-5 file:py-3 file:text-sm file:font-semibold file:text-white file:shadow-sm hover:file:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

const parseDateTimeString = (value: string | null) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

interface PaymentMethodOption {
  payment_method_id: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface PaymentAccountOption {
  account_id: string;
  payment_method_id: string | null;
  account_name: string;
  account_number: string | null;
  qr_image: string | null;
  instructions: string | null;
  is_active: boolean;
}

export default function Payment() {
  return (
    <Suspense fallback={<div className="booking-flow min-h-screen bg-base" />}>
      <PaymentContent />
    </Suspense>
  );
}

function PaymentContent() {
  const bookingDraft = useBookingStore((state) => state.bookingDraft);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState("");
  const [selectedPaymentAccountId, setSelectedPaymentAccountId] = useState("");
  const [paymentCatalogLoading, setPaymentCatalogLoading] = useState(true);
  const [paymentCatalogError, setPaymentCatalogError] = useState<string | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const selectedMethodRef = useRef("");
  useEffect(() => { selectedMethodRef.current = selectedPaymentMethodId; }, [selectedPaymentMethodId]);
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [paymentAutoApproved, setPaymentAutoApproved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const [submitError, setSubmitErrorValue] = useState<string | null>(null);
  const [submitIssues, setSubmitIssues] = useState<string[]>([]);
  const setSubmitError = (message: string | null) => { setSubmitErrorValue(message); setSubmitIssues([]); };
  const [acceptedTermsForReservation, setAcceptedTermsForReservation] = useState("");
  const [uploadedProofPath, setUploadedProofPath] = useState<string | null>(null);
  const [reservationReference, setReservationReference] = useState<string | null>(null);
  const [amountSent, setAmountSent] = useState<string | null>(null);
  const [hasPendingPayment, setHasPendingPayment] = useState(false);
  const [isCheckingPendingPayment, setIsCheckingPendingPayment] = useState(false);
  const [hasVerifiedDownpayment, setHasVerifiedDownpayment] = useState(false);
  const [isCheckingVerifiedDownpayment, setIsCheckingVerifiedDownpayment] = useState(false);
  const [submittedSummary, setSubmittedSummary] = useState<{
    guestName: string;
    adultCount: number;
    childCount: number;
    roomName: string;
    startDatetime: string;
    endDatetime: string;
    totalAmount: number;
    paidAmount: number;
    previousPaidAmount: number;
    payOption: "downpayment" | "full";
  } | null>(null);
  const ewalletFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadPaymentCatalog = async () => {
      setPaymentCatalogLoading(true);
      setPaymentCatalogError(null);
      try {
        const response = await fetch("/api/catalog", { cache: "no-store" });
        const result = (await response.json()) as {
          success?: boolean;
          catalog?: { paymentMethods?: PaymentMethodOption[]; paymentAccounts?: PaymentAccountOption[] };
        };
        if (!response.ok || !result.success) throw new Error("Catalog unavailable");
        if (!isMounted) return;
        const accounts = (result.catalog?.paymentAccounts ?? []).filter(account => account.is_active !== false && (account.qr_image || account.account_number));
        const methods = (result.catalog?.paymentMethods ?? []).filter((method) => !isCashMethod(method) && method.is_active !== false && accounts.some(account => account.payment_method_id === method.payment_method_id && (!isGcashMethod(method) || account.qr_image)));
        setPaymentMethods(methods);
        setPaymentAccounts(accounts);
        if (!methods.length) setPaymentCatalogError("No online payment accounts are available. Please contact the resort or try loading again.");
        const firstMethod = methods.find((method) => method.payment_method_id === selectedMethodRef.current) ?? methods[0];
        if (firstMethod) {
          setSelectedPaymentMethodId(firstMethod.payment_method_id);
        } else setSelectedPaymentMethodId("");
      } catch {
        if (isMounted) { setPaymentMethods([]); setPaymentAccounts([]); setSelectedPaymentMethodId(""); setPaymentCatalogError("Unable to load payment methods. Please try again."); }
      } finally {
        if (isMounted) setPaymentCatalogLoading(false);
      }
    };
    void loadPaymentCatalog();
    return () => { isMounted = false; };
  }, [catalogVersion]);

  useEffect(() => {
    const timer = window.setInterval(() => setCatalogVersion((current) => current + 1), 45 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const [ewalletDetails, setEwalletDetails] = useState({
    accountName: "",
    accountNumber: "",
    referenceNumber: "",
    uploadProof: null as File | null,
  });
  const [referenceInputError, setReferenceInputError] = useState<string | null>(null);
  const handleGcashReferenceChange = (value: string) => {
    if (!/^[0-9\s-]*$/.test(value)) {
      setReferenceInputError("GCash reference numbers must contain digits only.");
      return;
    }
    const digits = value.replace(/[\s-]/g, "");
    if (digits.length > 20) {
      setReferenceInputError("GCash reference numbers must contain 8–20 digits.");
      return;
    }
    setReferenceInputError(null);
    setEwalletDetails(current => ({ ...current, referenceNumber: digits }));
  };

  const [ewalletProofPreviewUrl, setEwalletProofPreviewUrl] = useState<string | null>(null);

  const handleEwalletProofChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;

    if (ewalletProofPreviewUrl) {
      URL.revokeObjectURL(ewalletProofPreviewUrl);
    }

    setEwalletDetails((prev) => ({ ...prev, uploadProof: file }));
    setEwalletProofPreviewUrl(file ? URL.createObjectURL(file) : null);
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
      if (ewalletProofPreviewUrl) {
        URL.revokeObjectURL(ewalletProofPreviewUrl);
      }
    };
  }, [ewalletProofPreviewUrl]);

  const firstName = bookingDraft.firstName || "Guest";
  const lastName = bookingDraft.lastName || "";
  const guestName = `${firstName} ${lastName}`.trim();
  const adultCount = bookingDraft.adultCount || 1;
  const childCount = bookingDraft.childCount || 0;

  const startDateTime = parseDateTimeString(bookingDraft.startDatetime || null);
  const endDateTime = parseDateTimeString(bookingDraft.endDatetime || null);
  const unitId = bookingDraft.unitId || "";
  const reservationId = bookingDraft.reservationId || "";
  const acceptedTerms = Boolean(reservationId && acceptedTermsForReservation === reservationId);
  const reservationReferenceFromDraft = bookingDraft.reservationReference || "";
  const isBalancePayment = Boolean(reservationId && unitId === "balance-payment");
  const [payOption, setPayOption] = useState<"downpayment" | "full">("downpayment");
  const paidAmount = bookingDraft.paidAmount || 0;

  useEffect(() => {
    if (isBalancePayment) {
      setPayOption("full");
    }
  }, [isBalancePayment]);

  // Check for pending payments when component mounts or reservation changes
  useEffect(() => {
    if (!reservationId) {
      setHasPendingPayment(false);
      return;
    }

    const checkPendingPayment = async () => {
      setIsCheckingPendingPayment(true);
      try {
        const supabase = createClient();
        const { data: pendingPayment } = await supabase
          .from("payments")
          .select("payment_id")
          .eq("reservation_id", reservationId)
          .eq("status", "pending")
          .limit(1)
          .maybeSingle();

        setHasPendingPayment(Boolean(pendingPayment));
      } catch (err) {
        console.error("Failed to check pending payments:", err);
        setHasPendingPayment(false);
      } finally {
        setIsCheckingPendingPayment(false);
      }
    };

    checkPendingPayment();
  }, [reservationId]);

  useEffect(() => {
    if (!reservationId) {
      setHasVerifiedDownpayment(false);
      return;
    }

    const checkVerifiedDownpayment = async () => {
      setIsCheckingVerifiedDownpayment(true);
      try {
        const supabase = createClient();
        const { data: verifiedDownpayment, error } = await supabase
          .from("payments")
          .select("payment_id")
          .eq("reservation_id", reservationId)
          .eq("payment_type", "downpayment")
          .eq("status", "verified")
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        setHasVerifiedDownpayment(Boolean(verifiedDownpayment));
      } catch (error) {
        console.error("Failed to check verified downpayment:", error);
        setHasVerifiedDownpayment(false);
      } finally {
        setIsCheckingVerifiedDownpayment(false);
      }
    };

    void checkVerifiedDownpayment();
  }, [reservationId]);

  useEffect(() => {
    if (hasVerifiedDownpayment || paidAmount > 0) setPayOption("full");
  }, [hasVerifiedDownpayment, paidAmount]);

  const roomName = bookingDraft.roomName || "Selected Room";
  const costSummary = buildBookingCostSummary(bookingDraft);
  const totalAmount = bookingDraft.total || 0;
  const downPayment = downPaymentAmount(totalAmount);
  const selectedServices = bookingDraft.services || [];
  const selectedPaymentMethod = paymentMethods.find((method) => method.payment_method_id === selectedPaymentMethodId);
  const gcash = Boolean(selectedPaymentMethod && isGcashMethod(selectedPaymentMethod));
  const methodAccounts = paymentAccounts.filter(account => account.payment_method_id === selectedPaymentMethodId && (!gcash || account.qr_image));
  const selectedPaymentAccount = methodAccounts.find(account => account.account_id === selectedPaymentAccountId) ?? methodAccounts[0];
  const chooseMethod = (id: string) => {
    if (id === selectedPaymentMethodId || submitting.current) return;
    setSelectedPaymentMethodId(id); setSelectedPaymentAccountId(""); setReferenceInputError(null); setSubmitError(null);
    setEwalletDetails({ accountName: "", accountNumber: "", referenceNumber: "", uploadProof: null });
    setEwalletProofPreviewUrl(null);
    if (ewalletFileInputRef.current) ewalletFileInputRef.current.value = "";
  };
  const downpaymentPercentage = DOWN_PAYMENT_PERCENT;

  const backToFormHref = isBalancePayment ? "/manage" : "/booking/details";
  const successStartDateTime = parseDateTimeString(submittedSummary?.startDatetime ?? null) ?? startDateTime;
  const successEndDateTime = parseDateTimeString(submittedSummary?.endDatetime ?? null) ?? endDateTime;
  const successGuestName = submittedSummary?.guestName ?? guestName;
  const successAdultCount = submittedSummary?.adultCount ?? adultCount;
  const successChildCount = submittedSummary?.childCount ?? childCount;
  const successRoomName = submittedSummary?.roomName ?? roomName;
  const successTotalAmount = submittedSummary?.totalAmount ?? totalAmount;
  const successPaidAmount = submittedSummary?.paidAmount ?? downPayment;
  const successPayOption = submittedSummary?.payOption ?? payOption;
  const remainingBalance = Math.max(totalAmount - paidAmount, 0);
  const effectivePayOption = resolvePaymentType(isBalancePayment, hasVerifiedDownpayment || paidAmount > 0, payOption);
  const payableNow = isBalancePayment
    ? hasVerifiedDownpayment || paidAmount > 0
      ? remainingBalance
      : payOption === "full"
        ? remainingBalance
        : downPayment
    : payOption === "full" ? totalAmount : downPayment;
  const actualPaymentAmount = amountSent === null ? payableNow : Number(amountSent);
  const amountIsValid = amountMeetsMinimum(actualPaymentAmount, payableNow);
  const previewAmount = amountIsValid ? actualPaymentAmount : payableNow;
  const remainingAfterThisPayment = Math.max(remainingBalance - previewAmount, 0);
  const excessAfterThisPayment = Math.max(previewAmount - remainingBalance, 0);
  const successExcess = Math.max((submittedSummary?.previousPaidAmount ?? 0) + successPaidAmount - successTotalAmount, 0);

  const handlePaymentSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    setSubmitError(null);
    const senderName = normalizeSenderName(ewalletDetails.accountName);
    if (!senderName) { setSubmitError(SENDER_NAME_ERROR); return; }
    if (gcash && referenceInputError) {
      setSubmitError(referenceInputError);
      return;
    }
    if (!amountIsValid) {
      setSubmitError(`Amount sent must be at least PHP ${payableNow.toFixed(2)} and have no more than two decimal places.`);
      return;
    }
    if (gcash ? !normalizeGcashReference(ewalletDetails.referenceNumber) : !normalizeManualPaymentReference(ewalletDetails.referenceNumber)) {
      setSubmitError(gcash ? "Enter the complete numeric GCash reference number (8-20 digits)." : "Enter the complete transaction reference (6-100 letters/digits, spaces or hyphens).");
      return;
    }

    if (!acceptedTerms) {
      setSubmitError("Please confirm the Terms and Conditions and Privacy Policy before submitting payment.");
      return;
    }

    if (hasPendingPayment) {
      setSubmitError("You have a payment pending approval. Please wait for it to be reviewed before submitting another payment.");
      return;
    }

    if (isCheckingPendingPayment || isCheckingVerifiedDownpayment) {
      setSubmitError("Checking your reservation payments. Please wait a moment.");
      return;
    }

    if ((hasVerifiedDownpayment || paidAmount > 0) && effectivePayOption === "downpayment") {
      setSubmitError("A verified downpayment already exists. Only the remaining balance can be paid.");
      return;
    }

    if (paymentCatalogLoading || !selectedPaymentMethodId || !selectedPaymentMethod || !selectedPaymentAccount) {
      setSubmitError("Please select an available payment method.");
      return;
    }

    if (gcash ? !isValidAccountNumber(ewalletDetails.accountNumber) : !isValidManualAccountIdentifier(ewalletDetails.accountNumber)) {
      setSubmitError(gcash ? "Enter an account number with 6-20 digits only." : "Enter the sender account, mobile number or email (3-120 characters).");
      return;
    }

    const selectedProof = ewalletDetails.uploadProof;

    if (!selectedProof) {
      setSubmitError("Please upload payment proof before submitting.");
      return;
    }

    if (!startDateTime || !endDateTime || !reservationId || (!unitId && !isBalancePayment)) {
      setSubmitError("Missing reservation details. Please go back and review your booking.");
      return;
    }

    if (!["image/png", "image/jpeg", "image/webp"].includes(selectedProof.type) || selectedProof.size > MAX_PAYMENT_PROOF_BYTES) {
      setSubmitError("Upload a PNG, JPEG, or WebP receipt smaller than 8 MB.");
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);

    try {
      const supabase = createClient();
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      if (!userId) {
        setSubmitError("Please sign in again before submitting payment.");
        return;
      }

      const safeFileName = selectedProof.name.replace(/[^a-zA-Z0-9.-]/g, "_");
      const uploadPath = `${userId}/${Date.now()}-${safeFileName}`;

      const { error: uploadError } = await supabase.storage
        .from(PAYMENT_PROOF_BUCKET)
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

      const checkoutResponse = await fetch("/api/reservations/payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reservationId,
          payment: {
            paymentMethodId: selectedPaymentMethodId,
            receivingAccountId: selectedPaymentAccount.account_id,
            type: effectivePayOption,
            amount: actualPaymentAmount,
            referenceNumber: ewalletDetails.referenceNumber,
            accountName: senderName,
            accountNumber: ewalletDetails.accountNumber,
            proofPath: uploadPath,
          },
        }),
      });

      let checkoutJson: {
        success?: boolean;
        message?: string;
        issues?: string[];
        errorCode?: string | null;
        payment?: { id?: string; status?: string; ocrStatus?: string; amount?: number; betaTest?: boolean };
        reservation?: { referenceNumber?: string };
      } | null = null;

      try {
        checkoutJson = (await checkoutResponse.json()) as {
          success?: boolean;
          message?: string;
          issues?: string[];
          errorCode?: string | null;
          payment?: { id?: string; status?: string; ocrStatus?: string; amount?: number; betaTest?: boolean };
          reservation?: { referenceNumber?: string };
        };
      } catch {
        checkoutJson = null;
      }

      if (!checkoutResponse.ok || !checkoutJson?.success) {
        setSubmitError(checkoutJson?.message || "We could not submit your payment. Please try again.");
        setSubmitIssues(Array.isArray(checkoutJson?.issues) ? checkoutJson.issues.filter(issue => typeof issue === "string" && issue.trim()) : []);
        setIsSubmitting(false);
        return;
      }

      setSubmittedSummary({
        guestName,
        adultCount,
        childCount,
        roomName,
        startDatetime: bookingDraft.startDatetime,
        endDatetime: bookingDraft.endDatetime,
        totalAmount,
        paidAmount: checkoutJson.payment?.amount ?? actualPaymentAmount,
        previousPaidAmount: paidAmount,
        payOption: effectivePayOption,
      });
      setReservationReference(checkoutJson.reservation?.referenceNumber || reservationReferenceFromDraft || null);
      setPaymentAutoApproved(checkoutJson.payment?.status === "verified");
      setPaymentComplete(true);
    } catch {
      setSubmitError("Unable to process payment right now. Please try again.");
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  if (paymentComplete) {
    return (
      <div className="booking-flow min-h-screen bg-base flex items-center justify-center px-4 py-6">
        <BookingGuide page="payment-complete" />
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-5 sm:p-12 text-center">
          <div className="w-20 h-20 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mb-4 text-2xl font-bold text-neutral sm:text-4xl">{paymentAutoApproved ? "Payment Approved!" : "Payment Submitted!"}</h1>
          <p className="mb-8 text-base text-neutral/70 sm:text-xl">{paymentAutoApproved ? "Your receipt passed verification and your reservation is confirmed." : "Your payment is awaiting cashier review."}</p>
          {successExcess > 0 && <p className="mb-6 rounded-lg bg-secondary/10 px-4 py-3 text-sm text-neutral">
            Excess payment: ₱{successExcess.toLocaleString("en-PH", { minimumFractionDigits: 2 })}. After staff verifies this payment, request the excess refund in Manage Booking.
          </p>}

          <div data-booking-guide="payment-result" className="booking-summary bg-base p-4 sm:p-8 rounded-2xl mb-8">
            <h2 className="text-2xl font-bold text-neutral mb-6">Reservation Summary</h2>
            <div className="space-y-4 text-left">
              <div className="flex justify-between pb-3 border-b border-neutral/10">
                <span className="text-neutral/70">Booking Reference</span>
                <span className="font-bold text-primary text-xl">{reservationReference || "-"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Guest Name</span>
                <span className="font-semibold text-neutral">{successGuestName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Check-in</span>
                <span className="font-semibold text-neutral">
                  {successStartDateTime?.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) || "N/A"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">Check-out</span>
                <span className="font-semibold text-neutral">
                  {successEndDateTime?.toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) || "N/A"}
                </span>
              </div>
              {!isBalancePayment && <div className="flex justify-between">
                <span className="text-neutral/70">Room Type</span>
                <span className="font-semibold text-neutral">{successRoomName}</span>
              </div>}
              {!isBalancePayment && <div className="flex justify-between">
                <span className="text-neutral/70">Adults</span>
                <span className="font-semibold text-neutral">{successAdultCount}</span>
              </div>}
              {!isBalancePayment && <div className="flex justify-between">
                <span className="text-neutral/70">Children</span>
                <span className="font-semibold text-neutral">{successChildCount}</span>
              </div>}
              <div className="flex justify-between pt-3 border-t border-neutral/10">
                <span className="text-neutral/70">Total Amount</span>
                <span className="whitespace-nowrap font-semibold text-neutral">₱{successTotalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">
                  {paymentAutoApproved ? "Approved payment" : "Submitted for review"} ({successPayOption === "full" ? "Full Payment" : "Down Payment"})
                </span>
                <span className="whitespace-nowrap font-semibold text-secondary">₱{successPaidAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/70">{paymentAutoApproved ? "Remaining balance" : "Expected balance after approval"}</span>
                <span className="whitespace-nowrap font-bold text-primary text-lg">₱{Math.max(successTotalAmount - (submittedSummary?.previousPaidAmount ?? 0) - successPaidAmount, 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
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
                {paymentAutoApproved ? "Your receipt passed verification and was automatically approved" : "Your proof of payment has been submitted for staff verification"}
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                {paymentAutoApproved ? "Your reservation is confirmed" : "This payment does not change your paid balance until staff approves it"}
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Check Manage Booking for your payment records and receipt
              </li>
              <li className="flex items-start gap-2">
                <svg className="w-5 h-5 text-accent mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Cancellation and refund terms follow the policy attached to your booking
              </li>
            </ul>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/" className="flex-1">
              <button className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                Return Home
              </button>
            </Link>
            <Link data-booking-guide="payment-manage" href="/manage" className="flex-1">
              <button className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform sm:hover:scale-105">
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
    <div className="booking-flow min-h-screen bg-base">
      <Navigation />

      <BookingProgress currentStep={4} />
      <BookingGuide page="payment" balance={isBalancePayment} disabled={isSubmitting} />

      <section className="px-4 py-6 sm:py-12">
        <div className="max-w-6xl mx-auto">
          <div className="grid min-w-0 gap-6 lg:grid-cols-3 lg:gap-8">
            <div className="min-w-0 lg:col-span-2">
              <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-8">
                <h2 className="mb-6 text-2xl font-bold text-neutral sm:mb-8 sm:text-3xl">Payment Details</h2>

                {!reservationId ? (
                  <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-neutral/80">
                    Save your booking on the review page first before submitting payment.
                  </div>
                ) : null}

                <div className="mb-8">
                  <h3 className="text-xl font-semibold text-neutral mb-4">Select Payment Method</h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {paymentMethods.map((method) => {
                      const isSelected = method.payment_method_id === selectedPaymentMethodId;
                      return <button key={method.payment_method_id} type="button" disabled={isSubmitting} aria-pressed={isSelected} onClick={() => chooseMethod(method.payment_method_id)} className={`p-6 rounded-xl border-2 text-left transition-all ${isSelected ? "border-primary bg-primary/5" : "border-neutral/20 hover:border-primary/50"}`}><p className="font-semibold text-neutral">{method.name}</p><p className="text-sm text-neutral/70">{isGcashMethod(method) ? "Receipt verification" : "Cashier verification"}</p></button>;
                    })}
                  </div>
                  {paymentCatalogLoading ? <p className="mt-3 text-sm text-neutral/60">Loading payment methods...</p> : null}
                  {paymentCatalogError ? <p role="alert" className="mt-3 text-sm text-red-700">{paymentCatalogError} <button type="button" disabled={paymentCatalogLoading || isSubmitting} onClick={() => setCatalogVersion((current) => current + 1)} className="font-semibold underline disabled:opacity-50">Reload payment options</button></p> : null}
                </div>

                <form onSubmit={handlePaymentSubmit}>
                  <fieldset disabled={isSubmitting} className="min-w-0">
                  {hasPendingPayment && (
                    <div className="mb-6 rounded-lg border border-highlight/40 bg-highlight/10 px-4 py-3 text-sm text-neutral">
                      You have a payment pending approval. Please wait for it to be reviewed before submitting another payment.
                    </div>
                  )}

                  {isBalancePayment ? (
                    <div data-booking-guide="payment-amount" className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <h3 className="text-lg font-semibold text-neutral mb-2">Pay for This Reservation</h3>
                      <p className="text-sm text-neutral/70">
                        {paidAmount > 0 ? "Pay the outstanding balance for your selected reservation." : `Choose a ${downpaymentPercentage}% down payment or full payment for your selected reservation.`}
                      </p>
                      {!isCheckingVerifiedDownpayment && !hasVerifiedDownpayment && paidAmount <= 0 && !hasPendingPayment && (
                        <div className="mt-3 rounded-lg border border-neutral/10 bg-white p-3">
                          <p className="text-xs font-medium text-neutral/70 mb-2">Choose Amount To Pay</p>
                          <div className="grid md:grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => setPayOption("downpayment")}
                              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                                payOption === "downpayment"
                                  ? "border-primary bg-primary/5"
                                  : "border-neutral/20 bg-white hover:border-primary/50"
                              }`}
                            >
                              <p className="font-semibold text-neutral">{downpaymentPercentage}% Down Payment</p>
                              <p className="text-neutral/70">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </button>
                            <button
                              type="button"
                              onClick={() => setPayOption("full")}
                              className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                                payOption === "full"
                                  ? "border-primary bg-primary/5"
                                  : "border-neutral/20 bg-white hover:border-primary/50"
                              }`}
                            >
                              <p className="font-semibold text-neutral">Full Balance</p>
                              <p className="text-neutral/70">₱{remainingBalance.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            </button>
                          </div>
                        </div>
                      )}
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-3 sm:px-4">
                        <span className="font-semibold text-neutral">Amount due now</span>
                        <span className="whitespace-nowrap text-xl font-bold text-primary">₱{payableNow.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  ) : (
                    <div data-booking-guide="payment-amount" className="mb-6 rounded-xl border border-neutral/10 bg-base p-4">
                      <h3 className="text-lg font-semibold text-neutral mb-3">Choose Amount To Pay</h3>
                      <div className="grid md:grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setPayOption("downpayment")}
                          className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                            payOption === "downpayment"
                              ? "border-primary bg-primary/5"
                              : "border-neutral/20 bg-white hover:border-primary/50"
                          }`}
                        >
                          <p className="font-semibold text-neutral">Down Payment ({downpaymentPercentage}%)</p>
                          <p className="text-sm text-neutral/70">₱{downPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPayOption("full")}
                          className={`rounded-lg border px-4 py-3 text-left transition-colors ${
                            payOption === "full"
                              ? "border-primary bg-primary/5"
                              : "border-neutral/20 bg-white hover:border-primary/50"
                          }`}
                        >
                          <p className="font-semibold text-neutral">Full Payment</p>
                          <p className="text-sm text-neutral/70">₱{totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        </button>
                      </div>
                    </div>
                  )}

                  <div data-booking-guide="payment-sent" className="mb-6 rounded-xl border border-neutral/15 p-4">
                    <label htmlFor="amount-sent" className="mb-2 block text-sm font-semibold text-neutral">Amount sent (PHP) *</label>
                    <input id="amount-sent" type="number" inputMode="decimal" step="0.01" min={payableNow} max="99999999.99"
                      value={amountSent ?? String(payableNow)} onChange={(event) => setAmountSent(event.target.value)} required
                      className="w-full rounded-lg border border-neutral/20 px-4 py-3 focus:border-primary focus:outline-none" aria-describedby="amount-sent-help" />
                    <p id="amount-sent-help" className="mt-2 text-sm text-neutral/70">Enter the exact amount on your payment receipt. Minimum: ₱{payableNow.toLocaleString("en-PH", { minimumFractionDigits: 2 })}. A larger payment reduces your balance.</p>
                    {excessAfterThisPayment > 0 && <p className="mt-2 text-sm text-neutral">Excess: ₱{excessAfterThisPayment.toLocaleString("en-PH", { minimumFractionDigits: 2 })}. You can request an excess refund in Manage Booking after approval.</p>}
                  </div>

                  {submitError && <PaymentErrorAlert message={submitError} issues={submitIssues} />}

                  {selectedPaymentMethod && (
                    <div className="mb-8">
                      <h3 className="text-xl font-semibold text-neutral mb-4">{selectedPaymentMethod.name} payment</h3>

                      <p className="mb-4 rounded-xl bg-primary/5 p-3 text-sm text-neutral/75">{gcash ? "Matching receipts may be confirmed automatically after verification." : "This payment requires cashier approval. Your payment remains pending until the received funds are verified."}</p>
                      <div className="space-y-4 mb-6">
                        <div>
                          <label htmlFor="payment-method" className="block text-sm font-medium text-neutral/70 mb-2">Payment method *</label>
                          <select
                            id="payment-method"
                            value={selectedPaymentMethodId}
                            onChange={event => chooseMethod(event.target.value)}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                          >
                            {paymentMethods.map((method) => <option key={method.payment_method_id} value={method.payment_method_id}>{method.name}</option>)}
                          </select>
                        </div>
                      </div>

                      <div data-booking-guide="payment-account" className="bg-neutral/5 p-3 sm:p-6 rounded-xl mb-6">
                        <h4 className="font-semibold text-neutral mb-3">Send payment to:</h4>
                        {methodAccounts.length > 1 && <label className="mb-4 block text-sm font-medium">Receiving account<select aria-label="Receiving account" value={selectedPaymentAccount?.account_id ?? ""} onChange={event => setSelectedPaymentAccountId(event.target.value)} className="mt-2 w-full rounded-lg border border-neutral/20 bg-white p-3">{methodAccounts.map(account => <option key={account.account_id} value={account.account_id}>{account.account_name} - {account.account_number ?? "QR payment"}</option>)}</select></label>}
                        <div className="space-y-2 text-sm">
                          <p><span className="text-neutral/70">Account Name:</span> <span className="font-semibold">{selectedPaymentAccount?.account_name ?? "-"}</span></p>
                          <p><span className="text-neutral/70">Number:</span> <span className="font-semibold">{selectedPaymentAccount?.account_number ?? "-"}</span></p>
                          {selectedPaymentAccount?.instructions ? <p className="text-neutral/70">{selectedPaymentAccount.instructions}</p> : null}
                          {selectedPaymentAccount?.qr_image ? <PaymentQr key={`${catalogVersion}:${selectedPaymentAccount.qr_image}`} src={selectedPaymentAccount.qr_image} name={selectedPaymentMethod?.name ?? "Payment"} onRetry={() => setCatalogVersion((current) => current + 1)} /> : null}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <div>
                          <label htmlFor="gcash-sender-name" className="block text-sm font-medium text-neutral/70 mb-2">Sender Name *</label>
                          <input
                            id="gcash-sender-name" data-booking-guide="payment-sender"
                            aria-describedby="gcash-sender-name-hint"
                            type="text"
                            maxLength={100}
                            value={ewalletDetails.accountName}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, accountName: sanitizeSenderName(e.target.value) })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                          <p id="gcash-sender-name-hint" className="mt-1 text-xs text-neutral/60">Use letters and name punctuation. No numbers or emojis.</p>
                        </div>
                        <div>
                          <label htmlFor="payment-sender-account" className="block text-sm font-medium text-neutral/70 mb-2">{gcash ? "Your Account Number *" : "Sender account / mobile number / email *"}</label>
                          <input
                            id="payment-sender-account"
                            type="text"
                            value={ewalletDetails.accountNumber}
                            inputMode={gcash ? "numeric" : "text"}
                            pattern={gcash ? "[0-9]{6,20}" : undefined}
                            minLength={gcash ? 6 : 3}
                            maxLength={gcash ? 20 : 120}
                            onChange={(e) => setEwalletDetails({ ...ewalletDetails, accountNumber: gcash ? sanitizeAccountNumber(e.target.value) : e.target.value })}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                        </div>
                        <div>
                          <label htmlFor="gcash-reference-number" className="block text-sm font-medium text-neutral/70 mb-2">Reference Number *</label>
                          <input
                            id="gcash-reference-number"
                            type="text"
                            value={ewalletDetails.referenceNumber}
                            inputMode={gcash ? "numeric" : "text"}
                            pattern={gcash ? "[0-9]{8,20}" : undefined}
                            minLength={gcash ? 8 : 6}
                            maxLength={gcash ? 40 : 100}
                            title={gcash ? "Enter the complete numeric GCash reference number (8-20 digits)." : "Enter the provider transaction reference."}
                            aria-invalid={Boolean(referenceInputError) || undefined}
                            aria-describedby={`gcash-reference-help${referenceInputError ? " gcash-reference-error" : ""}`}
                            onChange={event => gcash ? handleGcashReferenceChange(event.target.value) : setEwalletDetails(current => ({ ...current, referenceNumber: event.target.value }))}
                            className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                            required
                          />
                          <p id="gcash-reference-help" className="mt-1 text-xs text-neutral/60">{gcash ? "8-20 digits only. Leading zeroes are kept; pasted spaces and hyphens are removed." : "6-100 letters/digits, spaces or hyphens. Copy the actual transaction reference."}</p>
                          {referenceInputError && <p id="gcash-reference-error" role="alert" className="mt-1 text-sm text-red-700">{referenceInputError}</p>}
                        </div>
                        <div data-booking-guide="payment-proof" className="rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-4 sm:p-5">
                          <label htmlFor="gcash-payment-proof" className="mb-2 flex items-center gap-2 text-base font-semibold text-neutral">
                            <svg aria-hidden="true" className="h-6 w-6 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 16V4m-4 4 4-4 4 4M4 16v4h16v-4" /></svg>
                            {gcash ? "Upload original GCash screenshot *" : "Upload proof of payment *"}
                          </label>
                          <p id="gcash-proof-help" className="mb-3 text-sm text-neutral/70">PNG, JPG or WebP, up to {MAX_PAYMENT_PROOF_BYTES / 1024 / 1024} MB. {gcash ? "Choose the original GCash screenshot with the amount, recipient, reference and today's Philippine date/time fully readable. Photos of another screen, scans, blurred images and edited receipts are not accepted." : "Upload a clear receipt showing the amount, recipient, reference and payment date. A cashier will verify it against the resort's receiving account."}</p>
                          <input
                            id="gcash-payment-proof"
                            ref={ewalletFileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={handleEwalletProofChange}
                            aria-describedby="gcash-proof-help"
                            className={proofInputClass}
                            required
                          />
                          {ewalletDetails.uploadProof && (
                            <div className="mt-3 rounded-lg border border-neutral/20 p-3">
                              <p className="mb-2 break-words text-xs text-neutral/70">Selected file: {ewalletDetails.uploadProof.name}</p>
                              {ewalletDetails.uploadProof.type.startsWith("image/") && ewalletProofPreviewUrl ? (
                                <Image
                                  src={ewalletProofPreviewUrl}
                                  alt="E-wallet proof preview"
                                  width={800}
                                  height={400}
                                  unoptimized
                                  className="h-72 w-full rounded-md object-contain bg-neutral/5"
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

                  <div data-booking-guide="payment-policies" className="mb-6">
                    <PolicyAgreement key={reservationId} accepted={acceptedTerms} onChange={(accepted) => setAcceptedTermsForReservation(accepted ? reservationId : "")} reservationId={reservationId || undefined} />
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
                    <Link href={backToFormHref} className="flex-1">
                      <button type="button" className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                        Back
                      </button>
                    </Link>
                    <button
                      type="submit"
                      data-booking-guide="payment-submit"
                      disabled={isSubmitting || isCheckingPendingPayment || isCheckingVerifiedDownpayment || hasPendingPayment || !acceptedTerms || !reservationId || paymentCatalogLoading || !selectedPaymentAccount}
                      className="flex-1 bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform sm:hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                    >
                      {isSubmitting ? "Processing..." : "Confirm Payment"}
                    </button>
                  </div>
                  </fieldset>
                </form>
              </div>
            </div>

            <div className="min-w-0 lg:col-span-1">
              <div className="bg-white rounded-3xl shadow-xl booking-summary p-4 sm:p-8 lg:sticky lg:top-28">
                <h3 className="text-2xl font-bold text-neutral mb-6">Payment Summary</h3>

                <div className="space-y-4 mb-6">
                  <div className="pb-4 border-b border-neutral/10">
                    <p className="text-sm text-neutral/70 mb-1">Booking Reference</p>
                    <p className="font-mono font-bold text-neutral">{reservationReferenceFromDraft || "Save booking first"}</p>
                  </div>

                  {!isBalancePayment && <div className="pb-4 border-b border-neutral/10">
                    <div className="flex justify-between mb-1"><span className="text-neutral/70">Selected unit</span><span className="font-semibold text-neutral text-right">{roomName}</span></div>
                    <div className="flex justify-between mb-1"><span className="text-neutral/70">Booking mode</span><span className="font-semibold text-neutral">{bookingDraft.bookingMode.replace("_", " ")}</span></div>
                    <div className="flex justify-between"><span className="text-neutral/70">Duration</span><span className="font-semibold text-neutral">{startDateTime && endDateTime ? Math.round((endDateTime.getTime() - startDateTime.getTime()) / 3_600_000 * 100) / 100 : 0} hours</span></div>
                  </div>}

                  {!isBalancePayment && <div className="pb-4 border-b border-neutral/10">
                    <p className="text-sm font-semibold text-neutral mb-2">Booking Charges</p>
                    <div className="flex justify-between text-sm mb-1"><span className="text-neutral/70">{costSummary.packageLabel}</span><span className="whitespace-nowrap text-neutral">₱{costSummary.packageCharge.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>
                    <div className="flex justify-between text-sm mb-1"><span className="text-neutral/70">Guests</span><span className="text-neutral">{adultCount} adults, {childCount} children</span></div>
                    {costSummary.extraGuestCharge > 0 && <div className="flex justify-between text-sm"><span className="text-neutral/70">Extra guests ({costSummary.extraGuests})</span><span className="whitespace-nowrap text-neutral">₱{costSummary.extraGuestCharge.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>}
                  </div>}

                  {!isBalancePayment && selectedServices.length > 0 && (
                    <div className="pb-4 border-b border-neutral/10">
                      <p className="text-sm font-semibold text-neutral mb-2">Additional Services</p>
                      {selectedServices.map((service) => (
                        <div key={service.id || service.name} className="flex justify-between text-sm mb-1">
                          <span className="text-neutral/70">{service.name}</span>
                          <span className="whitespace-nowrap text-neutral">₱{service.price.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {!isBalancePayment && <div className="flex justify-between">
                    <span className="text-neutral/70">Subtotal</span>
                    <span className="whitespace-nowrap font-semibold text-neutral">₱{costSummary.subtotal.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>}

                  {!isBalancePayment && costSummary.tax > 0 && <div className="flex justify-between">
                    <span className="text-neutral/70">Tax</span>
                    <span className="whitespace-nowrap font-semibold text-neutral">₱{costSummary.tax.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>}

                  <div className="flex justify-between">
                    <span className="text-neutral/70">Total Amount</span>
                    <span className="whitespace-nowrap font-semibold text-neutral">₱{totalAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  {paidAmount > 0 && <div className="flex justify-between">
                    <span className="text-neutral/70">Already paid</span>
                    <span className="whitespace-nowrap font-semibold text-neutral">₱{paidAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>}

                  <div className="bg-primary/5 p-4 rounded-lg">
                    <div className="flex justify-between mb-2">
                      <span className="font-semibold text-neutral">
                        Amount sent
                      </span>
                      <span className="whitespace-nowrap text-xl font-bold text-primary">₱{previewAmount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                    <p className="text-xs text-neutral/60">{effectivePayOption === "full" ? "Payment is subject to staff verification." : "Your reservation is confirmed after staff verifies this payment."}</p>
                  </div>

                  <div className="flex justify-between pt-4 border-t border-neutral/10">
                    <span className="text-neutral/70">Balance after approval</span>
                    <span className="whitespace-nowrap font-semibold text-neutral">₱{remainingAfterThisPayment.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>

                  <p className="text-xs text-neutral/60">You can pay the remaining balance through Manage Booking after this payment is approved.</p>
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
                  <p className="text-xs text-neutral/70">Review the cancellation and refund policy attached to your booking in the agreement above.</p>
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
