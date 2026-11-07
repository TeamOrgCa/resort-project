import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

test("automatic approval sends confirmation and billing documents without propagating delivery failures", async () => {
  for (const fail of [false, true]) {
    const calls = [];
    const client = { from: table => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ error: null, data: table === "reservations"
        ? { reservation_id: "reservation", guest_id: "guest", reference_number: "MV-OCR", start_datetime: "2027-01-01", end_datetime: "2027-01-02" }
        : { email: "guest@example.com", first_name: "Test", last_name: "Guest" } }) };
      return query;
    } };
    const { sendOcrPaymentEmails } = loadTsModule("lib/server/ocr-payment-emails.ts", {
      "@/lib/supabase/admin": { createAdminClient: () => client },
      "@/lib/email": { sendReservationConfirmedEmail: async payload => { calls.push(["confirmation", payload]); if (fail) throw Error("SMTP unavailable"); return true; } },
      "@/lib/server/billing-email": { emailBillingDocuments: async (_client, reservation, payment, amount) => { calls.push(["billing", reservation.reservation_id, payment, amount]); if (fail) throw Error("Mail unavailable"); return { receiptSent: true, invoiceSent: true }; } },
    });
    await sendOcrPaymentEmails("reservation", "payment", 1500);
    assert.equal(calls.length, 2); assert.deepEqual(calls.find(c => c[0] === "billing"), ["billing", "reservation", "payment", 1500]);
    assert.equal(calls.find(c => c[0] === "confirmation")[1].reservationReference, "MV-OCR");
  }
});
