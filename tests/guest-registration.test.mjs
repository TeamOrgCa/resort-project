import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { validateGuestRegistration } = loadTsModule("lib/auth/guest-registration.ts");

const valid = {
  firstName: "  María  ", lastName: "Dela Cruz", middleName: "",
  email: "GUEST@EXAMPLE.COM", phoneNumber: "+639171234567",
  addressDetails: { streetAddress: "Block 2, Main Street", city: "Taytay", province: "Rizal", zipCode: "1920" },
  password: "secret123", confirmPassword: "secret123",
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

test("rejects email spaces, padding and invisible whitespace before normalization", () => {
  for (const email of [" guest@example.com", "guest@example.com ", "guest @example.com", "guest@example .com", "guest\t@example.com", "guest\n@example.com", "guest\u00a0@example.com", "guest\u200b@example.com", "   "]) {
    assert.match(validateGuestRegistration({ ...valid, email }).error, /without spaces/, JSON.stringify(email));
  }
});

for (const [description, change] of [
  ["missing first name", { firstName: " " }],
  ["punctuation-only last name", { lastName: "---" }],
  ["invalid middle name", { middleName: "123" }],
  ["invalid email", { email: "guest@" }],
  ["letters in phone number", { phoneNumber: "0917ABC1234" }],
  ["short phone number", { phoneNumber: "12345" }],
  ["empty address", { addressDetails: { streetAddress: " " } }],
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

test("registration enforces name, email and password boundaries on submitted payloads", () => {
  for (const field of ["firstName", "middleName", "lastName"]) {
    assert.ok(validateGuestRegistration({ ...valid, [field]: "A".repeat(75) }).value, field);
    assert.match(validateGuestRegistration({ ...valid, [field]: "A".repeat(76) }).error, /75 characters/, field);
  }
  const email = "a".repeat(242) + "@example.com";
  assert.equal(email.length, 254);
  assert.ok(validateGuestRegistration({ ...valid, email }).value);
  assert.ok(validateGuestRegistration({ ...valid, email: "a" + email }).error);
  for (const length of [7, 8, 128, 129]) {
    const result = validateGuestRegistration({ ...valid, password: "a".repeat(length), confirmPassword: "a".repeat(length) });
    assert.equal(Boolean(result.value), length >= 8 && length <= 128, `password length ${length}`);
  }
});

test("registration validates street length and requires exactly four ZIP digits before composing the saved address", () => {
  const addressDetails = { ...valid.addressDetails, streetAddress: "A".repeat(200), zipCode: "0123" };
  const result = validateGuestRegistration({ ...valid, addressDetails, address: "Untrusted client address" });
  assert.equal(result.value.address, `${"A".repeat(200)}, Taytay, Rizal, 0123`);
  assert.match(validateGuestRegistration({ ...valid, addressDetails: { ...addressDetails, streetAddress: "A".repeat(201) } }).error, /200 characters/);
  for (const zipCode of ["", "123", "12345", "12a4", "１２３４", 1234, null, undefined]) {
    assert.match(validateGuestRegistration({ ...valid, addressDetails: { ...addressDetails, zipCode } }).error, /exactly 4 digits/, String(zipCode));
  }
  assert.ok(validateGuestRegistration({ ...valid, addressDetails: undefined }).error);
});
