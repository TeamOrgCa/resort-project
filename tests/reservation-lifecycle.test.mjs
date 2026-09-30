import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

const enabled = process.env.RUN_RESERVATION_INTEGRATION === "1";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const staffEmail = process.env.RESERVATION_TEST_STAFF_EMAIL;
const staffPassword = process.env.RESERVATION_TEST_STAFF_PASSWORD;

test("reservation lifecycle database races", { skip: !enabled || !url || !serviceKey || !publishableKey || !staffEmail || !staffPassword }, async () => {
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const staff = createClient(url, publishableKey, { auth: { persistSession: false } });
  const tag = crypto.randomUUID().slice(0, 8);
  const email = `reservation-race-${tag}@example.invalid`;
  const { data: created, error: userError } = await admin.auth.admin.createUser({
    email, password: `Test-${crypto.randomUUID()}!`, email_confirm: true,
  });
  assert.ifError(userError);
  const guestId = created.user.id;
  const secondUser = await admin.auth.admin.createUser({
    email: `reservation-race-second-${tag}@example.invalid`,
    password: `Test-${crypto.randomUUID()}!`, email_confirm: true,
  });
  assert.ifError(secondUser.error);
  const secondGuestId = secondUser.data.user.id;
  const insertReservation = async (day, hour = 8, forGuestId = guestId) => {
    const start = `2040-10-${day}T${String(hour).padStart(2, "0")}:00:00+08:00`;
    const end = `2040-10-${day}T${String(hour + 3).padStart(2, "0")}:00:00+08:00`;
    const result = await admin.from("reservations").insert({
      guest_id: forGuestId, reference_number: `RACE-${tag}-${crypto.randomUUID().slice(0, 8)}`,
      start_datetime: start, end_datetime: end, booking_mode: "custom",
      adult_count: 1, child_count: 0, status: "pending",
    }).select("reservation_id, status, payment_deadline_at").single();
    return result;
  };
  const insertPayment = async (reservationId) => admin.from("payments").insert({
    reservation_id: reservationId, amount: 100, payment_type: "downpayment", status: "pending",
    reference_number: `PAY-${tag}-${crypto.randomUUID().slice(0, 8)}`,
    account_name: "Race test", proof_path: `tests/${tag}.png`,
  }).select("payment_id").single();

  try {
    const { error: guestError } = await admin.from("guests").insert({
      id: guestId, email, first_name: "Race", last_name: "Test",
      phone_number: "09170000000", address: "Integration test",
    });
    assert.ifError(guestError);
    const { error: secondGuestError } = await admin.from("guests").insert({
      id: secondGuestId, email: `reservation-race-second-${tag}@example.invalid`,
      first_name: "Second", last_name: "Guest", phone_number: "09170000001", address: "Integration test",
    });
    assert.ifError(secondGuestError);
    const { error: staffError } = await staff.auth.signInWithPassword({ email: staffEmail, password: staffPassword });
    assert.ifError(staffError);

    // Two requests for one guest and calendar date race; the database admits one.
    const [first, second] = await Promise.all([insertReservation("15", 8), insertReservation("15", 18)]);
    assert.equal([first, second].filter((r) => r.data).length, 1);
    assert.equal([first, second].filter((r) => r.error?.code === "23P01").length, 1);
    assert.ok((await insertReservation("15", 8, secondGuestId)).data, "another guest may book the same date");

    const expiredId = (first.data ?? second.data).reservation_id;
    const { error: setDeadlineError } = await admin.from("reservations")
      .update({ payment_deadline_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("reservation_id", expiredId);
    assert.ifError(setDeadlineError);
    const { error: expireError } = await admin.rpc("expire_unpaid_reservations");
    assert.ifError(expireError);
    const { data: expired } = await admin.from("reservations").select("status").eq("reservation_id", expiredId).single();
    assert.equal(expired.status, "expired");
    assert.ok((await insertReservation("15", 8)).data, "expired reservation releases its date");

    const raceReservation = await insertReservation("18", 8);
    assert.ifError(raceReservation.error);
    await admin.from("reservations").update({ payment_deadline_at: new Date(Date.now() - 1_000).toISOString() })
      .eq("reservation_id", raceReservation.data.reservation_id);
    const [latePayment] = await Promise.all([
      insertPayment(raceReservation.data.reservation_id),
      admin.rpc("expire_unpaid_reservations"),
    ]);
    assert.ok(latePayment.error, "a payment after the deadline must lose to expiry");
    await admin.rpc("expire_unpaid_reservations");
    const { data: racedExpiry } = await admin.from("reservations").select("status")
      .eq("reservation_id", raceReservation.data.reservation_id).single();
    assert.equal(racedExpiry.status, "expired");

    // A submitted proof wins the row lock; expiry must leave it reviewable.
    const reviewReservation = await insertReservation("16", 8);
    assert.ifError(reviewReservation.error);
    const payment = await insertPayment(reviewReservation.data.reservation_id);
    assert.ifError(payment.error);
    await admin.from("reservations").update({ payment_deadline_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("reservation_id", reviewReservation.data.reservation_id);
    await admin.rpc("expire_unpaid_reservations");
    const { data: submitted } = await admin.from("reservations").select("status")
      .eq("reservation_id", reviewReservation.data.reservation_id).single();
    assert.equal(submitted.status, "payment_submitted");

    // Two staff approvals race on the same pending payment; one succeeds.
    const approve = () => staff.from("payments").update({ status: "verified" })
      .eq("payment_id", payment.data.payment_id).eq("status", "pending").select("payment_id");
    const approvals = await Promise.all([approve(), approve()]);
    assert.equal(approvals.filter((r) => r.data?.length === 1).length, 1);
    const { data: confirmed } = await admin.from("reservations").select("status")
      .eq("reservation_id", reviewReservation.data.reservation_id).single();
    assert.equal(confirmed.status, "confirmed");

    const rejectedReservation = await insertReservation("17", 8);
    assert.ifError(rejectedReservation.error);
    const rejectedPayment = await insertPayment(rejectedReservation.data.reservation_id);
    assert.ifError(rejectedPayment.error);
    const { error: rejectError } = await staff.from("payments").update({ status: "rejected" })
      .eq("payment_id", rejectedPayment.data.payment_id).eq("status", "pending");
    assert.ifError(rejectError);
    const { data: rejected } = await admin.from("reservations").select("status")
      .eq("reservation_id", rejectedReservation.data.reservation_id).single();
    assert.equal(rejected.status, "rejected");
    assert.ok((await insertReservation("17", 8)).data, "rejected reservation releases its date");
  } finally {
    await staff.auth.signOut();
    await admin.auth.admin.deleteUser(guestId);
    await admin.auth.admin.deleteUser(secondGuestId);
  }
});
