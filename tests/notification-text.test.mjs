import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { formatNotificationText } = loadTsModule("lib/notification-text.ts");

test("saved payment approval notices omit OCR mechanics while keeping booking references and reschedule wording", () => {
  assert.equal(formatNotificationText("Payment automatically approved"), "Payment approved");
  assert.equal(formatNotificationText("Reservation MV-123 was confirmed after automatic OCR payment approval."), "Reservation MV-123 is confirmed. Your payment was approved.");
  assert.equal(formatNotificationText("Payment for reservation MV-123 was automatically approved because its receipt passed OCR validation."), "Payment for reservation MV-123 was approved.");
  assert.equal(formatNotificationText("Reservation rescheduled and automatically approved."), "Reservation rescheduled and automatically approved.");
});

test("notification currency uses two decimal places without changing references, dates or other numbers", () => {
  assert.equal(formatNotificationText("MV-123456: PHP 1500.000000 refund; balance ₱250.555000 on 2026-11-18 for 20 guests."), "MV-123456: PHP 1,500.00 refund; balance ₱250.56 on 2026-11-18 for 20 guests.");
  assert.equal(formatNotificationText("PHP 0, PHP 1,200.100000 and ₱-50.5."), "PHP 0.00, PHP 1,200.10 and ₱-50.50.");
  assert.equal(formatNotificationText("Reference PAY-000000; phone 09171234567; 08:30."), "Reference PAY-000000; phone 09171234567; 08:30.");
});
