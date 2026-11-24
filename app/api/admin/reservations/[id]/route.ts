import { serviceQuantityError } from "@/lib/booking/service-quantity";
import { NextResponse } from "next/server";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { staffHasPermission } from "@/lib/server/role-permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadReservationEditor } from "@/lib/server/reservation-editor";
import { bookedPackageChangeReason, detailsChanged, moneyRound, parseReservationEdit, previewReservationEdit, serviceSelectionsChanged, uuidPattern, validateEditWindow } from "@/lib/booking/reservation-edit";
import { checkReservationOverlap } from "@/lib/server/reservation-availability";
import { reschedulePolicy } from "@/lib/booking/reschedule-charge-policy";
import { createNotifications } from "@/lib/notifications";
import { manilaDateKey } from "@/lib/booking/manila-date";
import { BOOKING_LEAD_MESSAGE, isBookingStartAllowed } from "@/lib/booking/start-time";
import { emailUpdatedBillingStatement } from "@/lib/server/billing-email";
import { checkAdvanceBooking } from "@/lib/server/advance-booking";

type Context = { params: Promise<{ id: string }> };
const fail = (message: string, status: number) => NextResponse.json({ success: false, message }, { status });

export async function GET(_request: Request, context: Context) {
  const staff = await requireActiveStaff();
  if (!staff) return fail("Sign in as active resort staff.", 401);
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "reservations")) return fail("You cannot view reservations.", 403);
  const { id } = await context.params;
  if (!uuidPattern.test(id)) return fail("Invalid reservation.", 400);
  try {
    const detail = await loadReservationEditor(id);
    if (!detail) return fail("Reservation not found.", 404);
    const canEdit = await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation");
    const { snapshot: _snapshot, ...publicDetail } = detail;
    void _snapshot;
    const canApproveLateReschedule = canEdit && await staffHasPermission(staff.supabase, staff.staffUser.role, "reschedule_approval");
    return NextResponse.json({ success: true, ...publicDetail, canEdit, canManageDiscount: canEdit && ["admin", "staff"].includes(staff.staffUser.role), canApproveLateReschedule,
      canReduceServices: canEdit && !detail.lockedReason && (detail.canChangeDetails || ["admin", "staff"].includes(staff.staffUser.role)),
      canChangeAccommodation: canEdit && !detail.lockedReason && (detail.canChangeDetails || ["admin", "staff"].includes(staff.staffUser.role)),
      canRescheduleException: canApproveLateReschedule && Boolean(detail.lateRescheduleEligible) });
  } catch (error) { return fail(error instanceof Error ? error.message : "Unable to load reservation.", 500); }
}

export async function PATCH(request: Request, context: Context) {
  const staff = await requireActiveStaff();
  if (!staff) return fail("Sign in as active resort staff.", 401);
  if (!await staffHasPermission(staff.supabase, staff.staffUser.role, "edit_reservation")) return fail("You do not have permission to edit reservations.", 403);
  const { id } = await context.params;
  const edit = parseReservationEdit(await request.json().catch(() => null));
  if (!uuidPattern.test(id) || !edit) return fail("Enter valid reservation details, services and a reason for this change.", 400);
  try {
    const detail = await loadReservationEditor(id);
    if (!detail) return fail("Reservation not found.", 404);
    if (detail.version !== edit.version) return fail("This reservation or bill changed. Reload it before saving.", 409);
    if (detail.reservation.commercial_type === "public_swimming" && !detail.reservation.room_pricing) {
      if (detail.lockedReason) return fail(detail.lockedReason, 409);
      const preview = previewReservationEdit(detail.reservation, detail.bill, detail.services, detail.catalogServices, edit, detail.packageRates);
      if (preview.total !== moneyRound(edit.expectedTotal)) return fail("The public admission bill changed. Review it again.", 409);
      const { data, error } = await createAdminClient().rpc("public_staff_edit_booking", { p_reservation: id, p_staff: staff.staffUser.id,
        p_expected: detail.snapshot, p_patch: { ...edit, expectedTotal: preview.interimTotal } });
      if (error) return fail(["22023", "40001", "42501"].includes(error.code) ? error.message : "Unable to update public swimming.", error.code === "40001" ? 409 : error.code === "42501" ? 403 : 400);
      const billingEmail = await emailUpdatedBillingStatement(id, Number(data.totalAmount));
      return NextResponse.json({ success: true, ...data, billingEmail, message: "Public swimming guests, services and schedule updated. The bill has been recalculated." });
    }
    const now = Date.now();
    const scheduleChanged = Date.parse(detail.reservation.start_datetime) !== Date.parse(edit.startDatetime)
      || Date.parse(detail.reservation.end_datetime) !== Date.parse(edit.endDatetime);
    if (scheduleChanged && detail.reservation.checked_in_at) return fail("Checked-in reservations cannot be rescheduled.", 409);
    const policy = reschedulePolicy(detail.reservation.start_datetime, now);
    const needsException = scheduleChanged && !policy.allowed;
    const exceptionEligible = detail.reservation.status === "confirmed" && (detail.lateRescheduleEligible ?? !detail.lockedReason);
    const lateAuthorized = needsException && edit.lateRescheduleAcknowledged && exceptionEligible
      && await staffHasPermission(staff.supabase, staff.staffUser.role, "reschedule_approval");
    if (needsException && !lateAuthorized) return fail(`${policy.blockedReason} Authorized staff must acknowledge the late exception and document the guest's request.`, 400);
    if (detail.lockedReason && !lateAuthorized) return fail(detail.lockedReason, 409);
    const packageChange = bookedPackageChangeReason(detail.reservation, edit);
    if (packageChange) return fail(packageChange, 400);
    const oldUnit = detail.units.length === 1 && detail.units[0].quantity === 1 ? detail.units[0].unit_id : null;
    const unitChanged = edit.unitId !== oldUnit;
    if (unitChanged && (detail.reservation.commercial_type ?? "private_swimming") === "private_swimming" && !detail.reservation.room_pricing) return fail("All cottages are included with private swimming. An accommodation selection is not required.", 400);
    const changed = detailsChanged(detail.reservation, edit);
    const manager = ["admin", "staff"].includes(staff.staffUser.role);
    if ((scheduleChanged || (unitChanged && !manager)) && !detail.canChangeDetails && !lateAuthorized) return fail("The stay has started. Schedule changes are locked; accommodation changes require a manager.", 409);
    if (lateAuthorized && !detail.canChangeDetails && (unitChanged || edit.adultCount + edit.childCount !== detail.reservation.adult_count + detail.reservation.child_count)) return fail("A late exception may move the booked schedule; existing accommodation and guest counts must be retained.", 400);
    if (changed) {
      if (scheduleChanged && !isBookingStartAllowed(edit.startDatetime, now)) return fail(BOOKING_LEAD_MESSAGE, 400);
      const window = validateEditWindow(edit, detail.packageTimes, detail.reservation);
      if (!window.valid) return fail(window.message ?? "Invalid booking window.", 400);
    }
    if (scheduleChanged) {
      const advanceIssue = await checkAdvanceBooking(edit.startDatetime);
      if (advanceIssue) return fail(advanceIssue, 400);
      const { conflict, error } = await checkReservationOverlap(edit.startDatetime, edit.endDatetime, detail.reservation.guest_id, id);
      if (error) return fail("Unable to check booking availability. Please retry.", 503);
      if (conflict) return fail("These dates or times are already reserved or closed for maintenance. Choose another schedule.", 409);
    }
    if (unitChanged && (detail.units.length > 1 || detail.units.some(u => u.quantity !== 1))) return fail("Reservations with multiple accommodations require individual billing review.", 400);
    if (unitChanged && (!edit.unitId || !detail.catalogUnits.some(u => u.unit_id === edit.unitId && u.is_active && !u.archived_at))) return fail("Choose an available accommodation.", 400);
    if (!manager && !detail.canChangeDetails && detail.services.some(s => (edit.services.find(e => e.serviceId === s.service_id)?.quantity ?? 0) < s.quantity)) return fail("Reducing or removing services during a stay requires a manager.", 400);
    const quantityError = serviceQuantityError(edit.services, detail.catalogServices, detail.services);
    if (quantityError) return fail(quantityError, 400);
    const preview = previewReservationEdit(detail.reservation, detail.bill, detail.services, detail.catalogServices, edit, detail.packageRates, now);
    if (preview.total < 0) return fail("This change would produce a negative bill. Review the reservation charges.", 400);
    if (preview.total !== moneyRound(edit.expectedTotal)) return fail("Service prices or the bill changed. Reload to review the updated amount.", 409);
    if (edit.adultCount + edit.childCount === detail.reservation.adult_count + detail.reservation.child_count) { edit.adultCount = detail.reservation.adult_count; edit.childCount = detail.reservation.child_count; }
    const pricedServices = edit.services.map(s => ({ ...s, price: Number(detail.services.find(e => e.service_id === s.serviceId)?.price_at_time ?? detail.catalogServices.find(e => e.service_id === s.serviceId)!.price) }));
    const { data, error } = await createAdminClient().rpc(preview.hasDiscount ? (scheduleChanged ? "edit_staff_reservation_reschedule_with_discount" : "edit_staff_reservation_with_discount") : (scheduleChanged ? "edit_staff_reservation_reschedule" : "edit_staff_reservation"), {
      p_reservation: id, p_staff: staff.staffUser.id, p_expected: detail.snapshot,
      p_patch: { ...edit, expectedTotal: preview.interimTotal, services: pricedServices, packageDelta: preview.packageDelta, rescheduleFee: preview.rescheduleFee, dateRateAdjustment: preview.dateRateAdjustment },
    });
    if (error) {
      if (["PGRST202", "42883"].includes(error.code)) return fail(scheduleChanged ? "Apply the reschedule-policy migration before changing reservation dates." : "Reservation editing needs the reservation-edit migration. Ask your administrator to apply it.", 503);
      const status = error.code === "42501" ? 403 : ["40001", "23P01"].includes(error.code) ? 409 : error.code === "22023" ? 400 : 500;
      return fail(error.code === "23P01" ? "These dates are already reserved. Choose another schedule." : status === 500 ? "Unable to save the reservation. No changes were applied." : error.message, status);
    }
    if (scheduleChanged && detail.reservation.guest_id) {
      try { const { error: notificationError } = await createNotifications({ actorId: staff.staffUser.id, guestId: detail.reservation.guest_id,
        title: "Reservation rescheduled", message: `Reservation ${detail.reservation.reference_number} was moved to ${manilaDateKey(edit.startDatetime)}. The updated bill includes PHP ${preview.rescheduleFee.toFixed(2)} notice fee and any higher date rate.`,
        entityType: "reservation", entityId: id, guestActionUrl: "/manage" });
        if (notificationError) console.warn("Reservation saved but reschedule notification failed", notificationError);
      }
      catch (cause) { console.warn("Reservation saved but reschedule notification failed", cause); }
    }
    const billChanged = changed || unitChanged || serviceSelectionsChanged(detail.services, edit.services)
      || Number(data.totalAmount) !== Number(detail.bill.total_amount);
    const billingEmail = billChanged ? await emailUpdatedBillingStatement(id, Number(data.totalAmount)) : undefined;
    const emailMessage = billingEmail ? (billingEmail.sent ? " Updated billing statement emailed." : ` Updated billing statement was not emailed. ${billingEmail.error ?? "Check email delivery settings."}`) : "";
    return NextResponse.json({ success: true, ...data, billingEmail,
      message: `Reservation and bill updated. The change was recorded in the audit log.${emailMessage}` });
  } catch (error) { return fail(error instanceof Error ? error.message : "Unable to update reservation.", 500); }
}
