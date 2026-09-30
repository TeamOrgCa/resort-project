import test from "node:test";
import assert from "node:assert/strict";
import { validateGuestRegistration } from "../lib/auth/guest-registration.ts";

const valid = {
  firstName: "  María  ", lastName: "Dela Cruz", middleName: "",
  email: " GUEST@EXAMPLE.COM ", phoneNumber: "+639171234567",
  address: "Taytay, Rizal", password: "secret123", confirmPassword: "secret123",
};

test("accepts a valid guest without a middle name and normalizes contact details", () => {
  const result = validateGuestRegistration(valid);
  assert.ok(result.value);
  assert.equal(result.value.firstName, "María");
  assert.equal(result.value.middleName, null);
  assert.equal(result.value.email, "guest@example.com");
});

test("accepts an optional valid middle name", () => {
  const result = validateGuestRegistration({ ...valid, middleName: "O'Neil" });
  assert.equal(result.value?.middleName, "O'Neil");
});

for (const [description, change] of [
  ["missing first name", { firstName: " " }],
  ["punctuation-only last name", { lastName: "---" }],
  ["invalid middle name", { middleName: "123" }],
  ["invalid email", { email: "guest@" }],
  ["letters in phone number", { phoneNumber: "0917ABC1234" }],
  ["short phone number", { phoneNumber: "12345" }],
  ["empty address", { address: " " }],
  ["short password", { password: "12345", confirmPassword: "12345" }],
  ["mismatched passwords", { confirmPassword: "different" }],
]) {
  test(`rejects ${description}`, () => {
    assert.ok(validateGuestRegistration({ ...valid, ...change }).error);
  });
}

test("rejects malformed request bodies", () => {
  assert.ok(validateGuestRegistration(null).error);
  assert.ok(validateGuestRegistration([]).error);
  assert.ok(validateGuestRegistration({ ...valid, phoneNumber: 9171234567 }).error);
});
