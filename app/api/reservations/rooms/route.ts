import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { customerAccountUser } from "@/lib/auth/customer-access";
import { uuidPattern } from "@/lib/booking/reservation-edit";
import { normalizePersonName } from "@/lib/validation/name";
import { normalizePhilippineMobile } from "@/lib/validation/phone";
import { parsePhilippineAddress, validatePhilippineAddress } from "@/lib/address/philippine-address";
import { parseServiceSelections } from "@/lib/booking/service-quantity";
import { checkAdvanceBooking } from "@/lib/server/advance-booking";
import { LegalPolicyError, requireCurrentLegalPolicies } from "@/lib/server/legal-policies";

export async function POST(request: Request) {
  try {
    const supabase = await createClient(), { data: { user } } = await supabase.auth.getUser();
    if (!await customerAccountUser(supabase, user)) return NextResponse.json({ success: false, message: "Sign in with your customer account to save this booking." }, { status: 401 });
    const body = await request.json().catch(() => null), selectedServices = parseServiceSelections(body?.selectedServices);
    const first = normalizePersonName(body?.firstName), last = normalizePersonName(body?.lastName), phone = normalizePhilippineMobile(body?.phone);
    const address = typeof body?.address === "string" && body.address.length <= 1000 ? validatePhilippineAddress(parsePhilippineAddress(body.address)) : null;
    if (!body || !uuidPattern.test(body.requestId ?? "") || !first || !last || !phone || !address?.value || !selectedServices ||
      !Array.isArray(body.rooms) || body.rooms.length < 1 || body.rooms.length > 20 || ![3, 12].includes(body.durationHours) ||
      !Number.isSafeInteger(body.eligibleGuests) || body.eligibleGuests < 0 || body.eligibleGuests > 30 ||
      !body.rooms.every((r: { classificationId: string; occupants: number; pricingVersion: number }) => r && uuidPattern.test(r.classificationId ?? "") && Number.isSafeInteger(r.occupants) && r.occupants >= 1 && r.occupants <= 100 && Number.isSafeInteger(r.pricingVersion) && r.pricingVersion >= 1) ||
      typeof body.startDatetime !== "string" || typeof body.endDatetime !== "string" || !Number.isFinite(Date.parse(body.startDatetime)) || !Number.isFinite(Date.parse(body.endDatetime)) ||
      typeof body.expectedTotal !== "number" || !Number.isFinite(body.expectedTotal) || body.expectedTotal < 0 || body.expectedTotal > 99999999.99 ||
      typeof body.acceptedPoliciesVersion !== "string" || !Number.isSafeInteger(body.bookingPolicyVersion) || body.bookingPolicyVersion < 1 ||
      body.promoCode != null && (typeof body.promoCode !== "string" || body.promoCode.length > 40) ||
      body.specialRequests != null && (typeof body.specialRequests !== "string" || body.specialRequests.length > 2000)) return NextResponse.json({ success: false, message: "Complete the guest, room, service and discount details." }, { status: 400 });
    const advance = await checkAdvanceBooking(body.startDatetime);
    if (advance) return NextResponse.json({ success: false, message: advance }, { status: 400 });
    const policies = await requireCurrentLegalPolicies(supabase, body.acceptedPoliciesVersion);
    const input = { startDatetime: body.startDatetime, endDatetime: body.endDatetime, durationHours: body.durationHours,
      firstName: first, lastName: last, phone, address: address.value,
      rooms: body.rooms.map((r: { classificationId: string; occupants: number; pricingVersion: number }) => ({ classificationId: r.classificationId, occupants: r.occupants, pricingVersion: r.pricingVersion })),
      eligibleGuests: body.eligibleGuests, promoCode: body.promoCode || null, selectedServices, specialRequests: body.specialRequests?.trim() || "",
      expectedTotal: body.expectedTotal, bookingPolicyVersion: body.bookingPolicyVersion, termsPolicyId: policies.terms.policy_id, privacyPolicyId: policies.privacy.policy_id };
    const { data, error } = await createAdminClient().rpc("room_guest_reserve", { p_guest: user!.id, p_request: body.requestId, p_input: input });
    if (error) {
      const conflict = ["40001", "23P01", "40P01"].includes(error.code), invalid = ["22023", "22P02", "23514"].includes(error.code);
      return NextResponse.json({ success: false, code: conflict ? /polic|legal/i.test(error.message) ? "LEGAL_POLICY_CHANGED" : "ROOM_QUOTE_CHANGED" : undefined,
        message: conflict || invalid || error.code === "42501" ? error.message : "Room booking is temporarily unavailable. Please retry or contact the resort." }, { status: conflict ? 409 : invalid ? 400 : error.code === "42501" ? 403 : 503 });
    }
    return NextResponse.json({ success: true, reservation: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ success: false, code: e instanceof LegalPolicyError && e.status === 409 ? "LEGAL_POLICY_CHANGED" : undefined,
      message: e instanceof LegalPolicyError ? e.message : "Unable to save your room booking. Please retry." }, { status: e instanceof LegalPolicyError ? e.status : 503 });
  }
}
