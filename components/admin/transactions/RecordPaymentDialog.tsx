"use client";

import { useRef, useState } from "react";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";
import { createClient } from "@/lib/supabase/client";
import { isValidPaymentAmount } from "@/lib/booking/payment-policy";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";
import { normalizeSenderName, SENDER_NAME_ERROR } from "@/lib/validation/sender-name";

export type StaffPaymentMethod = { payment_method_id: string; name: string; type: string; is_active: boolean };
type Bill = { reservation_id: string; balance: number | null; reservation_status?: string };
export type RecordedPaymentResult = {
  success: boolean; message?: string; remainingBalance?: number; alreadyRecorded?: boolean;
  receipt?: { receipt_number?: string };
  billingEmails?: { error?: string; receiptSent?: boolean; invoiceSent?: boolean; receiptAlreadySent?: boolean; invoiceAlreadySent?: boolean };
};
const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
const isCash = (method: StaffPaymentMethod) => method.type.trim().toLowerCase() === "cash" || method.name.trim().toLowerCase() === "cash";

export default function RecordPaymentDialog({ initialReservationId, bills, references, methods, onSaved, onClose }: {
  initialReservationId: string; bills: Bill[]; references: Record<string, string>; methods: StaffPaymentMethod[];
  onSaved: (result: RecordedPaymentResult) => void; onClose: () => void;
}) {
  const [reservationId, setReservationId] = useState(initialReservationId);
  const [amount, setAmount] = useState(() => Number(bills.find(bill => bill.reservation_id === initialReservationId)?.balance ?? 0).toFixed(2));
  const [methodId, setMethodId] = useState("cash");
  const [cashReference, setCashReference] = useState(() => `CASH-${crypto.randomUUID().slice(0, 12).toUpperCase()}`);
  const [reference, setReference] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [proofPath, setProofPath] = useState("");
  const [received, setReceived] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const cash = methodId === "cash";
  const balance = Number(bills.find(bill => bill.reservation_id === reservationId)?.balance ?? 0);
  const nonCashMethods = methods.filter(method => method.is_active && !isCash(method));
  const methodAvailable = cash || nonCashMethods.some(method => method.payment_method_id === methodId);
  const valid = methodAvailable && received && isValidPaymentAmount(Number(amount)) && Number(amount) <= balance
    && (cash || (reference.trim().length >= 6 && accountName.trim() && accountNumber.trim() && file));

  const submit = async () => {
    if (saving.current || !valid) return;
    const sender = cash ? null : normalizeSenderName(accountName);
    if (!cash && !sender) { setError(SENDER_NAME_ERROR); return; }
    saving.current = true; setBusy(true); setError(null);
    try {
      let uploadedPath = proofPath;
      if (!cash && !uploadedPath) {
        if (!file || file.size < 1 || file.size > MAX_PAYMENT_PROOF_BYTES || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) {
          throw Error("Upload JPEG, PNG, WebP or PDF payment proof up to 8 MB.");
        }
        const client = createClient();
        const { data: { user } } = await client.auth.getUser();
        if (!user) throw Error("Sign in again before uploading payment proof.");
        const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" }[file.type];
        uploadedPath = `${user.id}/staff/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await client.storage.from(PAYMENT_PROOF_BUCKET).upload(uploadedPath, file, { contentType: file.type, upsert: false });
        if (uploadError) throw Error("Unable to upload proof. No payment has been recorded by this submission.");
        setProofPath(uploadedPath);
      }
      const response = await fetch("/api/admin/payments/manual-entry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reservationId, amount: Number(amount), expectedBalance: balance,
          paymentMethod: cash ? "cash" : "non_cash", paymentMethodId: cash ? undefined : methodId,
          paymentReference: cash ? cashReference : reference.trim(), cashReceived: cash && received, fundsReceived: received,
          ...(cash ? {} : { accountName: sender, accountNumber: accountNumber.trim(), proofPath: uploadedPath }),
        }),
      });
      const result: RecordedPaymentResult = await response.json();
      if (!response.ok || !result.success) throw Error(result.message ?? "Unable to confirm payment. Check the ledger and retry with the same reference.");
      onSaved(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to record payment."); }
    finally { saving.current = false; setBusy(false); }
  };

  return <CatalogDialog title="Record payment" description="Record money already received and apply it to the reservation bill." busy={busy} onClose={() => { if (!saving.current) onClose(); }}>
    <form className="space-y-4" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy} className="min-w-0 space-y-4">
        <label className="block text-sm font-medium text-black">Reservation<select data-autofocus value={reservationId} onChange={event => {
          setReservationId(event.target.value); setAmount(Number(bills.find(bill => bill.reservation_id === event.target.value)?.balance ?? 0).toFixed(2));
          setCashReference(`CASH-${crypto.randomUUID().slice(0, 12).toUpperCase()}`); setReference(""); setReceived(false); setError(null);
        }} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black">
          {bills.filter(bill => Number(bill.balance ?? 0) > 0 && ["pending", "confirmed"].includes(bill.reservation_status ?? "")).map(bill => <option key={bill.reservation_id} value={bill.reservation_id}>{references[bill.reservation_id] ?? bill.reservation_id} - balance {money(Number(bill.balance))}</option>)}
        </select></label>
        <label className="block text-sm font-medium text-black">Payment method<select value={methodId} onChange={event => {
          setMethodId(event.target.value); setReceived(false); setReference(""); setFile(null); setProofPath(""); setError(null);
          setCashReference(`CASH-${crypto.randomUUID().slice(0, 12).toUpperCase()}`);
        }} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black">
          <option value="cash">Cash (staff only)</option>
          {nonCashMethods.map(method => <option key={method.payment_method_id} value={method.payment_method_id}>{method.name}</option>)}
        </select></label>
        <p className="text-xs text-neutral/65">Other methods follow the active Business Catalog. Guest online payments support active non-cash methods; other methods require manual approval.</p>
        <label className="block text-sm font-medium text-black">Amount applied to this bill<input type="number" min="0.01" max={balance} step="0.01" required value={amount} onChange={event => { setAmount(event.target.value); setReceived(false); }} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black" /></label>
        <p className="text-xs text-neutral/65">The balance is filled in for full settlement. Enter a smaller amount for a partial payment. Give cash change separately.</p>
        <label className="block text-sm font-medium text-black">{cash ? "Cash reference" : "Transaction reference"}<input required readOnly={cash} minLength={cash ? undefined : 6} maxLength={100} value={cash ? cashReference : reference} onChange={event => { setReference(event.target.value); setReceived(false); }} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black" /></label>
        {!cash && <>
          <label className="block text-sm font-medium text-black">Sender account name<input required maxLength={120} value={accountName} onChange={event => { setAccountName(event.target.value); setReceived(false); }} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black" /></label>
          <label className="block text-sm font-medium text-black">Sender account number<input required inputMode="numeric" pattern="[0-9]{6,20}" maxLength={20} value={accountNumber} onChange={event => { setAccountNumber(event.target.value); setReceived(false); }} className="mt-1 min-h-11 w-full rounded-xl border border-neutral/20 bg-white p-3 text-base text-black" /></label>
          <label className="block text-sm font-medium text-black">Proof of payment<input type="file" required accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => { setFile(event.target.files?.[0] ?? null); setProofPath(""); setReceived(false); }} className="mt-1 block w-full text-sm" /></label>
          <p className="text-xs text-neutral/65">JPEG, PNG, WebP or PDF, up to 8 MB. Match the amount, recipient and reference against the actual receiving account.</p>
        </>}
        <label className="flex items-start gap-3 rounded-xl border border-neutral/10 p-3 text-sm text-neutral"><input type="checkbox" checked={received} onChange={event => setReceived(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />{cash ? "I have counted and received this cash from the guest." : "I verified the actual received funds, amount, recipient and transaction reference."}</label>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <p className="text-xs text-neutral/60">A receipt is issued in the reservation guest&apos;s name. The payment, receipt and balance update together.</p>
        <button disabled={busy || !valid} className="min-h-11 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Recording..." : "Record payment and issue receipt"}</button>
      </fieldset>
    </form>
  </CatalogDialog>;
}
