import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePersonName } from "@/lib/validation/name";
import { normalizePhilippineMobile } from "@/lib/validation/phone";
import { parsePhilippineAddress, validatePhilippineAddress } from "@/lib/address/philippine-address";
import { parseServiceSelections } from "@/lib/booking/service-quantity";
import { isValidGuestCounts } from "@/lib/booking/guest-count";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { requireCurrentLegalPolicies } from "@/lib/server/legal-policies";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function savePublicBooking(request: Request, actor: string, client: SupabaseClient, staff = false) {
  const body = await request.json().catch(() => null), services = parseServiceSelections(body?.selectedServices);
  const firstName = normalizePersonName(body?.firstName), lastName = normalizePersonName(body?.lastName), phone = normalizePhilippineMobile(body?.phone);
  const address = typeof body?.address === "string" && body.address.length <= 1000 ? validatePhilippineAddress(parsePhilippineAddress(body.address)) : null;
  if (!body || !firstName || !lastName || !phone || !address?.value || !services || services.some(s => !uuidPattern.test(s.serviceId)) || !uuidPattern.test(body.requestId ?? "") || !uuidPattern.test(body.typeId ?? "")
    || !Number.isSafeInteger(body.pricingVersion) || body.pricingVersion < 1 || !isValidGuestCounts(body.adultCount, body.childCount)
    || !Number.isSafeInteger(body.eligibleGuests) || body.eligibleGuests < 0 || body.eligibleGuests > body.adultCount + body.childCount
    || typeof body.startDatetime !== "string" || !Number.isFinite(Date.parse(body.startDatetime)) || typeof body.endDatetime !== "string" || !Number.isFinite(Date.parse(body.endDatetime))
    || typeof body.expectedTotal !== "number" || !Number.isFinite(body.expectedTotal) || body.expectedTotal < 0 || body.expectedTotal > 99999999.99
    || body.promoCode != null && (typeof body.promoCode !== "string" || body.promoCode.length > 40)
    || body.specialRequests != null && (typeof body.specialRequests !== "string" || body.specialRequests.length > 2000))
    return NextResponse.json({ message: "Complete the guest, public session, service and discount details." }, { status: 400 });
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
