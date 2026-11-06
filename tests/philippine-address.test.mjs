import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { parsePhilippineAddress, formatPhilippineAddress } = loadTsModule("lib/address/philippine-address.ts");
const { validateGuestProfile } = loadTsModule("lib/auth/guest-profile.ts");

test("saved addresses round-trip into editable fields while preserving street commas and leading ZIP zeros", () => {
  for (const address of [
    { streetAddress: "Unit 7, Block 2, Main Street", city: "Taytay", province: "Rizal", zipCode: "1920" },
    { streetAddress: "Unit 7, Main Street", city: "City of Manila", province: "Metro Manila (NCR)", zipCode: "0123" },
    { streetAddress: "Block 2", city: "Taytay", province: "Rizal", zipCode: "" },
  ]) assert.deepEqual(parsePhilippineAddress(formatPhilippineAddress(address)), address);
  assert.deepEqual(parsePhilippineAddress("Block 2, Manila"), { streetAddress: "Block 2, Manila", city: "", province: "", zipCode: "" });
});

test("profile saves validate structured address details and compose the database value", () => {
  const profile = { firstName: "Maria", lastName: "Cruz", phoneNumber: "09171234567",
    address: "Old address", addressDetails: { streetAddress: "Unit 7, Main Street", city: "Cainta", province: "Rizal", zipCode: "1900" } };
  assert.equal(validateGuestProfile(profile).value.address, "Unit 7, Main Street, Cainta, Rizal, 1900");
  assert.match(validateGuestProfile({ ...profile, addressDetails: { ...profile.addressDetails, zipCode: "190" } }).error, /exactly 4 digits/);
  assert.match(validateGuestProfile({ ...profile, addressDetails: { ...profile.addressDetails, streetAddress: "A".repeat(201) } }).error, /200 characters/);
});
