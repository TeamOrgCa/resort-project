import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { parsePhilippineAddress, validatePhilippineAddress } from "@/lib/address/philippine-address";
import { parseServiceSelections } from "@/lib/booking/service-quantity";
import { isValidGuestCounts } from "@/lib/booking/guest-count";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { requireCurrentLegalPolicies } from "@/lib/server/legal-policies";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function savePublicBooking(request: Request, actor: string, client: SupabaseClient, staff = false) {
  const invalid = (field: string, message: string) => NextResponse.json({ success: false, field, message }, { status: 400 });
  const body = await request.json().catch(() => null), services = parseServiceSelections(body?.selectedServices);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid("booking", "Unable to read the booking details. Return to the booking form and try again.");
  const firstName = normalizePersonName(body?.firstName), lastName = normalizePersonName(body?.lastName), phone = normalizePhilippineMobile(body?.phone);
  const address = typeof body?.address === "string" && body.address.length <= 1000 ? validatePhilippineAddress(parsePhilippineAddress(body.address)) : null;
  if (!firstName || !lastName) return invalid(!firstName ? "firstName" : "lastName", `Enter the guest's first and last name. ${PERSON_NAME_ERROR}`);
  if (!phone) return invalid("phone", PH_MOBILE_ERROR);
  if (!address?.value) return invalid("address", address?.error ?? "Complete your street address, province, city / municipality and four-digit ZIP code.");
  if (typeof body.requestId !== "string" || !uuidPattern.test(body.requestId)) return invalid("requestId", "Your booking draft is incomplete. Return to Booking Details and review it again.");
  if (typeof body.typeId !== "string" || !uuidPattern.test(body.typeId)) return invalid("typeId", "Choose Day or Night Public Swimming again from the booking calendar.");
  if (!Number.isSafeInteger(body.pricingVersion) || body.pricingVersion < 1) return invalid("pricingVersion", "Session rates are missing. Return to the calendar and choose your public swimming session again.");
  if (!isValidGuestCounts(body.adultCount, body.childCount)) return invalid("guests", "Enter whole-number adult and child counts, with at least one adult and no more than 30 guests in total.");
  if (!Number.isSafeInteger(body.eligibleGuests) || body.eligibleGuests < 0 || body.eligibleGuests > body.adultCount + body.childCount) return invalid("eligibleGuests", "Enter a PWD / senior count from 0 up to the total number of guests. Use 0 if none.");
  if (!services || services.some(s => !uuidPattern.test(s.serviceId))) return invalid("selectedServices", "Review your selected services and enter a valid quantity or duration for each. Services are optional.");
  if (typeof body.startDatetime !== "string" || !Number.isFinite(Date.parse(body.startDatetime)) || typeof body.endDatetime !== "string" || !Number.isFinite(Date.parse(body.endDatetime))) return invalid("session", "Choose a valid public swimming date and Day or Night session from the calendar.");
  if (typeof body.expectedTotal !== "number" || !Number.isFinite(body.expectedTotal) || body.expectedTotal < 0 || body.expectedTotal > 99999999.99) return invalid("expectedTotal", "The booking total is invalid. Return to Booking Details to refresh the total.");
  if (body.promoCode != null && (typeof body.promoCode !== "string" || body.promoCode.length > 40)) return invalid("promoCode", "Enter a valid promo code of up to 40 characters, or leave it blank. A promo code is optional.");
  if (body.specialRequests != null && (typeof body.specialRequests !== "string" || body.specialRequests.length > 2000)) return invalid("specialRequests", "Keep special requests within 2,000 characters.");
  if (!staff && (typeof body.acceptedPoliciesVersion !== "string" || !Number.isSafeInteger(body.bookingPolicyVersion))) return NextResponse.json({ message: "Accept the current booking policies." }, { status: 400 });
  const policies = staff ? null : await requireCurrentLegalPolicies(client, body.acceptedPoliciesVersion);
  const input = { firstName, lastName, phone, address: address.value, typeId: body.typeId, pricingVersion: body.pricingVersion,
    startDatetime: body.startDatetime, endDatetime: body.endDatetime, adultCount: body.adultCount, childCount: body.childCount,
    eligibleGuests: body.eligibleGuests, promoCode: body.promoCode || null, selectedServices: services, specialRequests: body.specialRequests?.trim() || "",
    expectedTotal: body.expectedTotal, bookingPolicyVersion: body.bookingPolicyVersion ?? null, termsPolicyId: policies?.terms.policy_id ?? null,
    privacyPolicyId: policies?.privacy.policy_id ?? null, ...(staff ? { staffActor: actor } : {}) };
  const { data, error } = await createAdminClient().rpc("public_reserve", { p_actor: actor, p_request: body.requestId, p_input: input, p_staff: staff });
  if (error) return NextResponse.json({ message: ["22023", "40001", "42501"].includes(error.code) ? error.message : "Unable to save public swimming. Please retry.", success: false },
    { status: error.code === "42501" ? 403 : error.code === "40001" ? 409 : error.code === "22023" ? 400 : 503 });
  return NextResponse.json({ success: true, reservation: data }, { status: 201 });
}
