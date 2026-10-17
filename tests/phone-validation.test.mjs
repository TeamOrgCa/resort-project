import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { normalizePhilippineMobile, philippineMobileInput } = loadTsModule("lib/validation/phone.ts");
const { saveGuestBookingPhone } = loadTsModule("lib/server/guest-booking-phone.ts");
const { validateGuestRegistration } = loadTsModule("lib/auth/guest-registration.ts");

test("Philippine mobile numbers normalize domestic, national and country-code formats to one saved value", () => {
  for (const input of ["09171234567", "9171234567", "639171234567", "+639171234567", "+63 917 123 4567", "0917-123-4567", "(0917) 123 4567"]) {
    assert.equal(normalizePhilippineMobile(input), "+639171234567", input);
    assert.equal(philippineMobileInput(input), "9171234567", input);
  }
});

test("wrong country codes, doubled trunk prefixes, letters, extensions and wrong lengths are rejected", () => {
  for (const input of [null, undefined, 9171234567, "", "1234567", "0917123456", "091712345678", "+6309171234567", "6309171234567",
    "+649171234567", "0917ABC4567", "09171234567 ext 123", "++639171234567", "+63+639171234567", "9.171234567", "+63287771234"]) {
    assert.equal(normalizePhilippineMobile(input), null, String(input));
    if (typeof input === "string") assert.equal(normalizePhilippineMobile(philippineMobileInput(input)), null, `display must not repair ${input}`);
  }
});

test("registration validates and stores the canonical country code", () => {
  const guest = { firstName: "Maria", lastName: "Cruz", middleName: "", email: "guest@example.com", address: "Taytay, Rizal", password: "secret123", confirmPassword: "secret123" };
  assert.equal(validateGuestRegistration({ ...guest, phoneNumber: "0917 123 4567" }).value.phoneNumber, "+639171234567");
  for (const phoneNumber of ["12345678901", "+6309171234567", "+649171234567"]) assert.match(validateGuestRegistration({ ...guest, phoneNumber }).error, /Philippine mobile/);
});

function client({ stored = "09171234567", readError = null, writeError = null } = {}) {
  const calls = [];
  const db = { from(table) {
    const q = { select: fields => { calls.push({ table, fields }); return q; }, eq: (field, value) => { calls.push({ field, value }); return q; },
      update: values => { calls.push({ table, values }); return q; }, maybeSingle: async () => ({ data: { phone_number: stored }, error: readError }),
      then: (yes, no) => Promise.resolve({ error: writeError }).then(yes, no) };
    return q;
  } };
  return { db, calls };
}

test("booking validates and saves its supplied contact on the authenticated guest profile", async () => {
  const h = client();
  assert.equal(await saveGuestBookingPhone(h.db, "guest-id", "+63 917 123 4567"), "+639171234567");
  assert.deepEqual(h.calls, [{ table: "guests", values: { phone_number: "+639171234567" } }, { field: "id", value: "guest-id" }]);
  const invalid = client();
  await assert.rejects(() => saveGuestBookingPhone(invalid.db, "guest-id", "0917abc4567"), error => error.status === 400);
  assert.equal(invalid.calls.length, 0);
});

test("older booking clients must have a valid saved contact; profile read/write failures stop creation", async () => {
  const saved = client();
  assert.equal(await saveGuestBookingPhone(saved.db, "guest-id", undefined), "+639171234567");
  assert.deepEqual(saved.calls[0], { table: "guests", fields: "phone_number" });
  for (const input of [{ stored: "Unknown" }, { stored: null }, { stored: "+649171234567" }]) {
    const invalid = client(input);
    await assert.rejects(() => saveGuestBookingPhone(invalid.db, "guest-id", undefined), error => error.status === 400);
    assert.equal(invalid.calls.some(call => call.values), false);
  }
  for (const input of [{ readError: { message: "Offline" } }, { writeError: { message: "Denied" } }]) {
    await assert.rejects(() => saveGuestBookingPhone(client(input).db, "guest-id", undefined), error => error.status === 503);
  }
});
