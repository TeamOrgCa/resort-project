import test from "node:test";
import assert from "node:assert/strict";
import { downPaymentAmount, moneyMatches } from "../lib/booking/payment-policy.ts";
import { assessGcashText } from "../lib/booking/gcash-receipt.ts";

const receipt = `GCash\nPayment sent successfully\nAmount Sent\nPHP 5,000.00\nReference No. 1234567890123\nSent to MarVille Resort\n0917***1234`;
const expected = {
  amount: 5000,
  reference: "1234567890123",
  recipientName: "MarVille Resort",
  recipientNumber: "09171231234",
};

test("20% down payment rounds an odd cent upward", () => {
  assert.equal(downPaymentAmount(100.01), 20.01);
  assert.equal(moneyMatches(20.01, downPaymentAmount(100.01)), true);
  assert.equal(moneyMatches(20, downPaymentAmount(100.01)), false);
});

test("GCash receipt screens as consistent when key fields agree", () => {
  assert.equal(assessGcashText(receipt, expected).status, "consistent");
});

test("GCash receipt flags a conflicting sent amount", () => {
  assert.equal(assessGcashText(receipt.replace("5,000.00", "500.00"), expected).status, "mismatch");
});

test("GCash receipt recognizes a peso amount and rejects a failed status", () => {
  assert.equal(assessGcashText(receipt.replace("PHP 5,000.00", "₱5,000.00"), expected).status, "consistent");
  assert.equal(assessGcashText(receipt.replace("Payment sent successfully", "Payment failed"), expected).status, "mismatch");
});

test("GCash receipt with unreadable fields remains for manual review", () => {
  assert.equal(assessGcashText("GCash\nPayment sent successfully", expected).status, "unreadable");
});
