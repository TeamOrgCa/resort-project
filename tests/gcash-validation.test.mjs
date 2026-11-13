import test from "node:test";
import assert from "node:assert/strict";
import { amountMeetsMinimum, isValidPaymentAmount } from "../lib/booking/payment-policy.ts";
import { assessGcashText, isGcashMethod, isVerifiedGcashReceipt, normalizeGcashReference, readGcashReceiptDates } from "../lib/booking/gcash-receipt.ts";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const now = Date.parse("2026-10-13T02:00:00Z");
const expected = { amount: 1500, minimumAmount: 1000, reference: "1234567890123", recipientName: "MarVille Resort", recipientNumber: "09171231234", now };
const receipt = `GCash\nPayment sent successfully\nAmount Sent\nPHP 1,500.00\nReference Number: 1234567890123\nSent to MarVille Resort\n0917***1234\nOct 13, 2026 09:15 AM`;
test("larger down payments and excess full payments meet the minimum without changing actual amount", () => {
  assert.equal(amountMeetsMinimum(1500, 1000), true);
  assert.equal(amountMeetsMinimum(3500, 3000), true);
  assert.equal(amountMeetsMinimum(999.99, 1000), false);
  assert.equal(amountMeetsMinimum(2999.99, 3000), false);
  assert.equal(assessGcashText(receipt, expected).amount, 1500);
  assert.equal(assessGcashText(receipt, expected).status, "consistent");
});
test("the exact receipt amount must match the entered amount and cover the selected minimum", () => {
  assert.equal(assessGcashText(receipt, { ...expected, amount: 1000 }).status, "mismatch");
  assert.equal(assessGcashText(receipt, { ...expected, minimumAmount: 3000 }).status, "mismatch");
  assert.equal(assessGcashText(receipt.replace("1,500.00", "999.99") + "\nFee PHP 0.01\nTotal Amount PHP 1,000.00", { ...expected, amount: 1000 }).status, "mismatch");
});
test("amounts cannot have fractional cents, zero, infinity or overflow", () => {
  for (const value of [0, -1, NaN, Infinity, 1.005, 100000000]) assert.equal(isValidPaymentAmount(value), false);
  assert.equal(isValidPaymentAmount(99999999.99), true);
  assert.equal(isValidPaymentAmount(20.01), true);
});
test("conflicting sent amounts cannot be hidden by a matching amount elsewhere", () => {
  assert.equal(assessGcashText(receipt + "\nAmount Paid PHP 100.00", expected).status, "unreadable");
  assert.equal(assessGcashText(receipt.replace("PHP 1,500.00", "1,500.00"), expected).status, "consistent");
  assert.equal(assessGcashText(receipt.replace("PHP 1,500.00", "PHP 1,500.001"), expected).status, "unreadable");
});
test("reference verification uses the whole labelled field, never a matching phone or substring", () => {
  assert.equal(normalizeGcashReference("1234-5678 90123"), expected.reference);
  for (const value of ["ABC1234567890123", "1234567", "123456789012345678901", "1234.567890123"]) assert.equal(normalizeGcashReference(value), null);
  assert.equal(assessGcashText(receipt.replace("1234567890123", "001234567890123"), expected).status, "mismatch");
  assert.equal(assessGcashText(receipt.replace("1234567890123", "9876543210987") + "\nSender account 1234567890123", expected).status, "mismatch");
  assert.equal(assessGcashText(receipt.replace("Reference Number: 1234567890123", "Reference No.\n1234 5678 90123"), expected).status, "consistent");
});

const sendMoney = `A*****B C.\n+63 9** *** 5095\nSent via GCash\nAmount 100.00\nTotal Amount Sent PHP100.00\nRef No. 6046080000001 Oct 13, 2026 6:22 PM`;
const sendMoneyExpected = { amount: 100, minimumAmount: 100, reference: "6046080000001", recipientNumber: "09171235095", now: Date.parse("2026-10-13T10:30:00Z"), successCheckSeen: true };

test("Send Money graphic success and a reference/date sharing a footer are supported", () => {
  const result = assessGcashText(sendMoney, sendMoneyExpected);
  assert.equal(result.status, "consistent", result.notes); assert.equal(result.amount, 100); assert.equal(result.reference, sendMoneyExpected.reference); assert.equal(result.paidAt, "2026-10-13T10:22:00.000Z");
  assert.equal(assessGcashText(sendMoney, { ...sendMoneyExpected, successCheckSeen: false }).status, "unreadable");
  assert.equal(assessGcashText(sendMoney.replace("Total Amount Sent", "Total Amount"), sendMoneyExpected).status, "unreadable");
  assert.equal(assessGcashText(sendMoney.replace("6046080000001", "6046080000002"), sendMoneyExpected).status, "mismatch");
  assert.equal(assessGcashText(sendMoney.replace("6046080000001", "6046080000001extra"), sendMoneyExpected).status, "unreadable");
  assert.equal(assessGcashText(sendMoney.replace("6046080000001", "6046080000001123"), sendMoneyExpected).status, "mismatch");
  assert.equal(assessGcashText(sendMoney + "\nRef No. 6046080000002", sendMoneyExpected).status, "unreadable");
});

test("masked recipient dots preserve every visible digit and need the complete phone shape", () => {
  for (const phone of ["+63 9•• ••• 5095", "+63 9.. ... 5095", "+63 9·· ··· 5095", "+63 9** *** 5095"]) {
    const result = assessGcashText(sendMoney.replace("+63 9** *** 5095", phone), sendMoneyExpected); assert.equal(result.status, "consistent", result.notes);
  }
  for (const phone of ["+63 9** *** 5094", "+63 8** *** 5095", "+63 9* *** 5095", "+63 *** *** ****"]) assert.notEqual(assessGcashText(sendMoney.replace("+63 9** *** 5095", phone), sendMoneyExpected).status, "consistent");
});

test("iPhone masking accepts four clear suffix digits with a fully masked national prefix", () => {
  for (const phone of ["+63 ••• ••• 5095", "+63 *** *** 5095", "+63 9•• ••• 5095"]) {
    const text = sendMoney.replace("+63 9** *** 5095", phone);
    assert.equal(assessGcashText(text, sendMoneyExpected).status, "consistent");
    assert.notEqual(assessGcashText(text, { ...sendMoneyExpected, recipientNumber: "09171235094" }).status, "consistent");
  }
  for (const phone of ["5095", "+63 *** *** *095", "+63 *** *** 5094", "+63 ** *** 5095", "+63 8** *** 5095"]) {
    assert.notEqual(assessGcashText(sendMoney.replace("+63 9** *** 5095", phone), sendMoneyExpected).status, "consistent", phone);
  }
});

test("Android-style full recipient and spaced reference preserve leading zeroes and every account digit", () => {
  const text = `A••B C•••••D E.\n+63 917 123 5095\nSent via GCash\nAmount 200.00\nTotal Amount Sent ₱200.00\nRef No. 0046 080 000001 Oct 13, 2026 5:53 PM`;
  const input = { ...sendMoneyExpected, amount: 200, minimumAmount: 100, reference: "0046 080 000001" };
  const result = assessGcashText(text, input);
  assert.equal(result.status, "consistent", result.notes);
  assert.equal(result.reference, "0046080000001"); assert.equal(result.amount, 200);
  assert.equal(result.paidAt, "2026-10-13T09:53:00.000Z");
  assert.equal(assessGcashText(text, { ...input, reference: "46080000001" }).status, "mismatch");
  assert.equal(assessGcashText(text, { ...input, reference: "0046080000001" }).status, "consistent");
  assert.notEqual(assessGcashText(text, { ...input, recipientNumber: "09991235095" }).status, "consistent");
  assert.equal(assessGcashText(text, { ...input, amount: 100 }).status, "mismatch");
  assert.equal(assessGcashText(text, { ...input, minimumAmount: 201 }).status, "mismatch");
  assert.equal(assessGcashText(text.replace("Oct 13", "Oct 12"), input).status, "mismatch");
});

test("Send Money layout does not bypass amount, today, recipient or incomplete-status checks", () => {
  assert.equal(assessGcashText(sendMoney, { ...sendMoneyExpected, minimumAmount: 101 }).status, "mismatch");
  assert.equal(assessGcashText(sendMoney, { ...sendMoneyExpected, amount: 99 }).status, "mismatch");
  assert.equal(assessGcashText(sendMoney.replace("Oct 13", "Oct 12"), sendMoneyExpected).status, "mismatch");
  assert.equal(assessGcashText(sendMoney.replace("6:22 PM", "7:22 PM"), sendMoneyExpected).status, "mismatch");
  assert.equal(assessGcashText(sendMoney, { ...sendMoneyExpected, recipientNumber: "09991235094" }).status, "unreadable");
  for (const status of ["Transaction failed", "Transfer pending", "Processing", "Transaction reversed"]) assert.equal(assessGcashText(`${sendMoney}\n${status}`, sendMoneyExpected).status, "mismatch");
});
test("recipient phone digits must agree even if the name or last four digits match", () => {
  assert.notEqual(assessGcashText(receipt.replace("0917***1234", "0999***1234"), expected).status, "consistent");
  assert.notEqual(assessGcashText(receipt.replace("0917***1234", "09179991234"), expected).status, "consistent");
  assert.equal(assessGcashText(receipt.replace("0917***1234", "+63 917 123 1234"), expected).status, "consistent");
});
test("receipt dates parse in Manila independently of server timezone", () => {
  for (const value of ["Oct 13, 2026 09:15 AM", "13 October 2026 9:15:00 AM", "2026-10-13 09:15", "10/13/2026 09:15 AM", "Oct 13, 2026\nTime: 09:15 AM", "Oct13,2026 9:15AM", "Oct 13,20269:15 AM"]) {
    assert.deepEqual(readGcashReceiptDates(value), ["2026-10-13T01:15:00.000Z"]);
  }
  assert.deepEqual(readGcashReceiptDates("Feb 30, 2026 09:15 AM"), []);
  assert.deepEqual(readGcashReceiptDates("Oct 13, 2026 24:15"), []);
});
test("today is the Philippine calendar day, including UTC midnight boundaries", () => {
  const early = receipt.replace("09:15 AM", "12:15 AM");
  assert.equal(assessGcashText(early, { ...expected, now: Date.parse("2026-10-12T17:00:00Z") }).status, "consistent");
  assert.equal(assessGcashText(receipt.replace("Oct 13", "Oct 12"), expected).status, "mismatch");
  assert.equal(assessGcashText(receipt.replace("Oct 13", "Oct 14"), expected).status, "mismatch");
  assert.equal(assessGcashText(receipt.replace("09:15 AM", "11:00 AM"), expected).status, "mismatch");
  assert.equal(assessGcashText(receipt.replace("Oct 13, 2026 09:15 AM", ""), expected).status, "unreadable");
  assert.equal(assessGcashText(receipt + "\nOct 13, 2026 08:00 AM", expected).status, "unreadable");
});
test("a consistent status alone cannot bypass required extracted fields", () => {
  assert.equal(isVerifiedGcashReceipt({ status: "consistent", notes: "OK" }), false);
  assert.equal(isVerifiedGcashReceipt(assessGcashText(receipt, expected)), true);
  assert.equal(isGcashMethod({ name: "GCash", type: "ewallet" }), true);
  assert.equal(isGcashMethod({ name: "Bank", type: "bank" }), false);
  assert.equal(isGcashMethod({ name: "NotGCash", type: "bank" }), false);
});

const guestId = "11111111-1111-4111-8111-111111111111";
const reservationId = "22222222-2222-4222-8222-222222222222";
const paymentBody = { reservationId, payment: { paymentMethodId: "gcash", type: "downpayment", amount: 1500, referenceNumber: "1234-5678 90123", accountName: "Guest", accountNumber: "09171231234", proofPath: `${guestId}/proof.png` } };
function paymentHarness({ beta = false, authenticated = true, owner = guestId, method = "GCash", paid = 0, total = 5000, pending = false, ocrStatus = "consistent", proofMissing = false, accountMissing = false, insertError = null } = {}) {
  const inserted = [], inspected = [], manualProofs = [], emails = [];
  const manual = method !== "GCash" && method !== "Cash";
  const client = { auth: { getUser: async () => ({ data: { user: authenticated ? { id: guestId } : null }, error: null }) },
    from: table => {
      const filters = {};
      const query = { select: () => query, not: () => query, order: () => query, eq: (key, value) => { filters[key] = value; return query; }, limit: () => query,
        maybeSingle: async () => ({ error: null, data: table === "payment_methods" ? { name: method, type: "ewallet", is_active: true }
          : table === "reservations" ? { reservation_id: reservationId, guest_id: owner, reference_number: "MV-TEST", status: paid ? "confirmed" : "pending", payment_deadline_at: new Date(Date.now() + 600000).toISOString() }
          : table === "transactions" ? { total_amount: total, paid_amount: paid, balance: Math.max(total - paid, 0) }
          : table === "payment_accounts" ? accountMissing ? null : { account_id: "33333333-3333-4333-8333-333333333333", account_name: "MarVille Resort", account_number: "09171231234" }
          : table === "payments" ? pending && filters.status === "pending" ? { payment_id: "pending" } : null : null }) };
      return query;
    } };
  const route = loadTsModule("app/api/reservations/payment/route.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": { createAdminClient: () => ({ rpc: async (name, { p_payment: row }) => {
      assert.equal(name, manual ? "submit_manual_guest_payment" : (manual || ocrStatus === "skipped") ? "submit_unscreened_gcash_payment" : beta ? "submit_beta_gcash_payment" : "submit_consistent_gcash_payment"); inserted.push(row);
      return { data: insertError ? null : { payment_id: "new", is_beta_test: beta, status: (manual || ocrStatus === "skipped") ? "pending" : "verified", ocr_status: (manual || ocrStatus === "skipped") ? "not_applicable" : row.ocr_status, auto_approved: !manual && ocrStatus !== "skipped",
        paid_amount: paid + ((manual || ocrStatus === "skipped") ? 0 : row.amount), remaining_balance: Math.max(total - paid - ((manual || ocrStatus === "skipped") ? 0 : row.amount), 0), overpaid_amount: Math.max(paid + ((manual || ocrStatus === "skipped") ? 0 : row.amount) - total, 0), reservation_status: (manual || ocrStatus === "skipped") && !paid ? "payment_submitted" : "confirmed" }, error: insertError };
    } }) },
    "@/lib/server/ocr-payment-emails": { sendOcrPaymentEmails: async (...args) => { emails.push(args); } },
    "@/lib/server/manual-payment-proof": { inspectManualPaymentProof: async (...args) => { manualProofs.push(args); return !proofMissing; } },
    "@/lib/server/gcash-ocr": { inspectPaymentProof: async (_client, input) => { inspected.push(input); return proofMissing ? null : { status: ocrStatus, betaTest: beta, notes: "Receipt checked", amount: input.amount, reference: input.reference, paidAt: (manual || ocrStatus === "skipped") ? undefined : "2026-10-13T01:15:00.000Z" }; } },
    "@/lib/notifications": { createNotifications: async () => ({ error: null }), NOTIFICATION_AUDIENCES: { payment: [] } },
  });
  return { post: body => route.POST(new Request("http://localhost/api/reservations/payment", { method: "POST", body: JSON.stringify(body) })), inserted, inspected, manualProofs, emails };
}
test("payment API saves actual OCR amount and canonical reference for larger down payments", async () => {
  const h = paymentHarness(); const response = await h.post(paymentBody); const body = await response.json();
  assert.equal(response.status, 201); assert.equal(h.inspected[0].minimumAmount, 1000);
  assert.equal(h.inserted[0].amount, 1500); assert.equal(body.payment.amount, 1500);
  assert.equal(h.inserted[0].reference_number, "1234567890123");
  assert.match(h.inserted[0].ocr_checked_at, /T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/);
  assert.equal(h.inserted[0].receipt_paid_at, "2026-10-13T01:15:00.000Z");
  assert.equal(h.inserted[0].status, "pending");
  assert.equal(body.payment.status, "verified"); assert.equal(body.payment.autoApproved, true);
  assert.equal(body.reservation.paidAmount, 1500); assert.equal(body.reservation.remainingBalance, 3500);
});

test("payment API rejects alphanumeric references before reading a receipt or saving a payment", async () => {
  for (const referenceNumber of ["ABC1234567890123", "123456789012A", "1e12345678", "+1234567890123", "1234.567890123"]) {
    const h = paymentHarness();
    const response = await h.post({ ...paymentBody, payment: { ...paymentBody.payment, referenceNumber } });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /numeric GCash reference/);
    assert.equal(h.inspected.length, 0); assert.equal(h.inserted.length, 0);
  }
});

test("payment API rejects sender digits and emojis before OCR or payment creation", async () => {
  for (const accountName of ["Guest123", "12345", "Guest ９", "Guest 😀", "Guest 1️⃣", "...", "Guest\tName"]) {
    const h = paymentHarness();
    const response = await h.post({ ...paymentBody, payment: { ...paymentBody.payment, accountName } });
    assert.equal(response.status, 400, accountName);
    assert.match((await response.json()).message, /sender name/);
    assert.equal(h.inspected.length, 0); assert.equal(h.inserted.length, 0);
  }
  const h = paymentHarness();
  assert.equal((await h.post({ ...paymentBody, payment: { ...paymentBody.payment, accountName: "  José  O’Neil Jr.  " } })).status, 201);
  assert.equal(h.inserted[0].account_name, "José O’Neil Jr.");
});
test("full balance payments require the current outstanding amount and allow excess", async () => {
  for (const [amount, status] of [[3499.99, 400], [3500, 201], [4000, 201]]) {
    const h = paymentHarness({ paid: 1500 });
    const response = await h.post({ ...paymentBody, payment: { ...paymentBody.payment, type: "full", amount } });
    assert.equal(response.status, status); if (status === 201) assert.equal(h.inserted[0].amount, amount); else assert.equal(h.inserted.length, 0);
  }
});
test("failed, missing and unreadable OCR never insert a payment", async () => {
  for (const [ocrStatus, status] of [["unreadable", 422], ["mismatch", 422], ["rejected", 422], ["not_applicable", 422], ["screening_unavailable", 503]]) {
    const h = paymentHarness({ ocrStatus }); assert.equal((await h.post(paymentBody)).status, status); assert.equal(h.inserted.length, 0);
  }
  const h = paymentHarness({ proofMissing: true }); assert.equal((await h.post(paymentBody)).status, 400); assert.equal(h.inserted.length, 0);
});
test("ownership, cash exclusion, receiving account, pending payments and amount are enforced", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ owner: "other" }, 403], [{ method: "Cash" }, 400], [{ pending: true }, 409], [{ accountMissing: true }, 503]]) {
    const h = paymentHarness(options); assert.equal((await h.post(paymentBody)).status, status); assert.equal(h.inserted.length, 0);
  }
  for (const amount of [999.99, 1000.001, 100000000]) {
    const h = paymentHarness(); assert.equal((await h.post({ ...paymentBody, payment: { ...paymentBody.payment, amount } })).status, 400); assert.equal(h.inserted.length, 0);
  }
});
test("reference reuse and a concurrently changed bill return a conflict", async () => {
  for (const code of ["23505", "40001"]) {
    const h = paymentHarness({ insertError: { code, message: "Conflict" } }); assert.equal((await h.post(paymentBody)).status, 409);
  }
});

test("later payments use manual review when OCR is disabled and preserve the current verified balance", async () => {
  const h = paymentHarness({ ocrStatus: "skipped" }); const response = await h.post(paymentBody);
  assert.equal(response.status, 201); const result = await response.json();
  assert.equal(result.payment.status, "pending"); assert.equal(result.payment.autoApproved, false);
  assert.equal(result.reservation.paidAmount, 0); assert.equal(result.reservation.remainingBalance, 5000);
  assert.equal(h.inserted[0].ocr_checked_at, null); assert.equal(h.inserted[0].receipt_paid_at, null);
});

test("other-method down payments and balance payments stay pending without crediting the entered amount", async () => {
  for (const paid of [0, 1500]) {
    const h = paymentHarness({ method: "Bank", paid, beta: true });
    const response = await h.post({ ...paymentBody, payment: { ...paymentBody.payment, receivingAccountId: "33333333-3333-4333-8333-333333333333", referenceNumber: "BANK-001234 AB", type: paid ? "full" : "downpayment", amount: paid ? 3500 : 1500, autoApproved: true } });
    assert.equal(response.status, 201); const json = await response.json();
    assert.equal(json.payment.status, "pending"); assert.equal(json.payment.autoApproved, false);
    assert.equal(json.reservation.paidAmount, paid); assert.equal(json.reservation.remainingBalance, 5000 - paid);
    assert.equal(json.reservation.status, paid ? "confirmed" : "payment_submitted");
    assert.equal(h.inspected.length, 0); assert.equal(h.manualProofs.length, 1); assert.deepEqual(h.emails, []);
    assert.equal(h.inserted[0].ocr_status, "not_applicable"); assert.equal(h.inserted[0].ocr_checked_at, null); assert.equal(h.inserted[0].receipt_paid_at, null);
    assert.equal(h.inserted[0].reference_number, "BANK001234AB");
  }
});

test("other-method payments retain account, proof, owner, pending-payment and reference validation", async () => {
  const payment = { ...paymentBody.payment, receivingAccountId: "33333333-3333-4333-8333-333333333333", referenceNumber: "BANK-001234 AB" };
  for (const [options, status] of [[{ proofMissing: true }, 400], [{ accountMissing: true }, 503], [{ pending: true }, 409], [{ owner: "other" }, 403], [{ authenticated: false }, 401]]) {
    const h = paymentHarness({ method: "Bank", ...options }); assert.equal((await h.post({ ...paymentBody, payment })).status, status); assert.equal(h.inserted.length, 0);
  }
  for (const change of [{ receivingAccountId: undefined }, { referenceNumber: "123" }, { referenceNumber: "bank<script>" }, { amount: 999.99 }, { accountNumber: "bad\naccount" }]) {
    const h = paymentHarness({ method: "Bank" }); assert.equal((await h.post({ ...paymentBody, payment: { ...payment, ...change } })).status, 400); assert.equal(h.inserted.length, 0);
  }
});

test("beta comparison toggle accepts an extracted old receipt but still enforces amount, recipient, status and readable fields", () => {
 const old=receipt.replace('Oct 13, 2026','Oct 13, 2020');
 const beta={...expected,reference:'9999999999999',skipReferenceAndDateChecks:true};
 const result=assessGcashText(old,beta);assert.equal(result.status,'consistent');assert.equal(result.reference,'1234567890123');assert.equal(result.paidAt,'2020-10-13T01:15:00.000Z');
 assert.equal(assessGcashText(old,{...beta,skipReferenceAndDateChecks:false}).status,'mismatch');
 assert.equal(assessGcashText(old,{...beta,amount:1501}).status,'mismatch');
 assert.notEqual(assessGcashText(old,{...beta,recipientNumber:'09999999999'}).status,'consistent');
 assert.equal(assessGcashText(old.replace('Payment sent successfully','Payment failed'),beta).status,'mismatch');
 assert.equal(assessGcashText(old.replace('Reference Number: 1234567890123',''),beta).status,'unreadable');
 assert.equal(assessGcashText(old.replace('Oct 13, 2020 09:15 AM',''),beta).status,'unreadable');
});

test("later payments choose the beta RPC only for a server-marked OCR result",async()=>{
 const h=paymentHarness({beta:true});const response=await h.post(paymentBody);assert.equal(response.status,201);assert.equal((await response.json()).payment.betaTest,true);
});


test("payment approvals send confirmation and billing emails during beta testing too", async () => {
  for (const beta of [false, true]) {
    const h = paymentHarness({ beta });
    assert.equal((await h.post(paymentBody)).status, 201);
    assert.deepEqual(h.emails, [[reservationId, "new", 1500]]);
  }
  const pending = paymentHarness({ ocrStatus: "skipped" });
  assert.equal((await pending.post(paymentBody)).status, 201);
  assert.deepEqual(pending.emails, []);
});
