import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const { DEFAULT_PACKAGE_TIMES } = loadTsModule("lib/booking/package-times.ts");
const { parsePackageRates } = loadTsModule("lib/booking/package-rates.ts");
const { computeBookingPricing } = loadTsModule("lib/booking/pricing.ts");
const { buildBookingWindow } = loadTsModule("lib/booking/policy.ts");
const { loadQuotedPackageRates, loadPackageRates } = loadTsModule("lib/server/package-rates.ts");
const { calculateRescheduleCharges } = loadTsModule("lib/booking/reschedule-charges.ts");
const copy = () => structuredClone(legacyRates);

test("all six edited prices and per-head charges drive quotes without changing package windows", () => {
  const rates = copy();
  for (const [tier, date] of [["weekday", "2027-06-14"], ["weekend", "2027-06-18"]]) {
    for (const [mode, duration] of [["day", 8], ["night", 12], ["whole_day", 22]]) {
      rates[tier][mode] = { baseRate: 4321.25, addOnPerHead: 123.45 };
      const window = buildBookingWindow({ date: new Date(`${date}T00:00:00`), bookingMode: mode, wholeDayVariant: "day_to_night" });
      const quote = computeBookingPricing({ ...window, bookingMode: mode, adultCount: 20, childCount: 2, servicesTotal: 250 }, rates);
      assert.equal(quote.rateTier, tier);
      assert.equal(quote.total, 4818.15);
      assert.equal(quote.extraGuestTotal, 246.9);
      assert.equal(quote.downPaymentMin, 963.63);
      assert.equal((Date.parse(window.endDatetime) - Date.parse(window.startDatetime)) / 3600000, duration);
      assert.equal(new Date(window.startDatetime).getUTCHours(), mode === "night" ? 10 : 0);
    }
  }
  const alternate = buildBookingWindow({ date: new Date("2027-06-18T00:00:00"), bookingMode: "whole_day", wholeDayVariant: "night_to_day" });
  assert.equal(new Date(alternate.startDatetime).getUTCHours(), 10);
  assert.equal(new Date(alternate.endDatetime).getUTCHours(), 8);
});

test("rate input rejects missing combinations, editable times and invalid money", () => {
  assert.deepEqual(parsePackageRates(legacyRates), legacyRates);
  for (const value of [-1, 0, 1.001, Infinity, "7500", 1000000]) {
    const rates = copy(); rates.weekday.day.baseRate = value;
    assert.equal(parsePackageRates(rates), null);
  }
  const missing = copy(); delete missing.weekend.night; assert.equal(parsePackageRates(missing), null);
  const withTime = copy(); withTime.weekday.day.startTime = "09:00"; assert.equal(parsePackageRates(withTime), null);
  const freeExtra = copy(); freeExtra.weekday.day.addOnPerHead = 0; assert.ok(parsePackageRates(freeExtra));
  freeExtra.weekday.day.addOnPerHead = -1; assert.equal(parsePackageRates(freeExtra), null);
});

const db = (schedule, error = null) => ({ rpc: (name, args) => {
  assert.equal(name, "get_package_rates");
  return { maybeSingle: async () => ({ data: args.p_version === 1 ? { version: 1, rates: legacyRates } : schedule, error }) };
} });
test("stale quotes and missing migration fail instead of silently using other rates", async () => {
  const client = db({ version: 2, rates: copy() });
  await assert.rejects(loadQuotedPackageRates(client, 1), error => error.status === 409);
  assert.equal((await loadQuotedPackageRates(client, 2)).version, 2);
  assert.equal((await loadPackageRates(client, 1)).version, 1);
  await assert.rejects(loadPackageRates(db(null, { code: "PGRST202" })), error => error.status === 503);
});

test("rescheduling uses the booked schedule's weekday/weekend difference and extra heads", () => {
  const rates = copy(); rates.weekend.day = { baseRate: 9000, addOnPerHead: 250 };
  const result = calculateRescheduleCharges({ originalStart: "2027-06-14T08:00:00+08:00", originalEnd: "2027-06-14T16:00:00+08:00",
    newStart: "2027-06-18T08:00:00+08:00", newEnd: "2027-06-18T16:00:00+08:00", bookingMode: "day", adultCount: 22, childCount: 0,
    now: Date.parse("2027-05-01T00:00:00Z"), rates });
  assert.equal(result.rateAdjustment, 1750);
});

function adminHarness({ allowed = true, rpcError = null } = {}) {
  const calls = [];
  const route = loadTsModule("app/api/admin/catalog/package-rates/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => allowed ? { supabase: { rpc: async (name, args) => {
      calls.push({ name, args }); return { data: 2, error: rpcError };
    } } } : null },
  });
  return { calls, get: () => route.GET(), save: body => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ times: DEFAULT_PACKAGE_TIMES, ...body }) })) };
}
test("only administrators publish valid rates, and concurrent saves require reload", async () => {
  const denied = adminHarness({ allowed: false }); assert.equal((await denied.save({})).status, 403); assert.equal(denied.calls.length, 0);
  const h = adminHarness(); assert.equal((await h.save({ rates: {}, expectedVersion: 1 })).status, 400); assert.equal(h.calls.length, 0);
  const response = await h.save({ rates: legacyRates, expectedVersion: 1 }); assert.equal(response.status, 200);
  assert.equal(h.calls[0].name, "publish_package_rates"); assert.equal(h.calls[0].args.p_expected_version, 1);
  assert.equal((await response.json()).schedule.version, 2);
  const stale = adminHarness({ rpcError: { code: "40001", message: "Reload rates" } });
  assert.equal((await stale.save({ rates: legacyRates, expectedVersion: 1 })).status, 409);
});

test("restoring defaults reads the original schedule and saves it with the current version", async () => {
  const edited = copy(); edited.weekday.day.baseRate = 5; edited.weekend.whole_day.addOnPerHead = 1;
  const published = [];
  const originalReads = [];
  const query = {
    select: fields => { assert.equal(fields, "rates"); return query; },
    order: (field, options) => { originalReads.push({ field, ...options }); return query; },
    limit: count => { assert.equal(count, 1); return query; },
    maybeSingle: async () => ({ data: { rates: legacyRates }, error: null }),
  };
  const route = loadTsModule("app/api/admin/catalog/package-rates/route.ts", {
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ supabase: {
      from: table => { assert.equal(table, "package_rate_versions"); return query; },
      rpc: (name, args) => {
        if (name === "get_package_rates") return db({ version: 6, rates: edited }).rpc(name, args);
        assert.equal(name, "publish_package_rates"); published.push(args);
        return Promise.resolve({ data: 7, error: null });
      },
    } }) },
  });
  const loaded = await route.GET(); assert.equal(loaded.status, 200);
  const body = await loaded.json();
  assert.equal(body.schedule.version, 6); assert.deepEqual(body.schedule.rates, edited);
  assert.deepEqual(body.defaultRates, legacyRates);
  assert.deepEqual(originalReads, [{ field: "version", ascending: true }]);
  assert.equal(published.length, 0);
  const saved = await route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ rates: body.defaultRates, times: body.defaultTimes, expectedVersion: body.schedule.version }) }));
  assert.equal(saved.status, 200);
  assert.deepEqual(published, [{ p_rates: legacyRates, p_expected_version: 6, p_times: DEFAULT_PACKAGE_TIMES }]);
  assert.equal((await saved.json()).schedule.version, 7);
});

test("reading default prices requires administrator access", async () => {
  const denied = adminHarness({ allowed: false });
  assert.equal((await denied.get()).status, 403); assert.equal(denied.calls.length, 0);
});

test("chatbot quotes saved prices and cannot fall back to the static swimming prices", () => {
  const { getBookingGuidance, instructionForGuestBookings, resortContext } = loadTsModule("lib/chatbot/guardrails.ts");
  const rates = copy(); rates.weekday.day.baseRate = 4321;
  assert.match(getBookingGuidance("What are the swimming rates?", rates), /4,321/);
  assert.doesNotMatch(getBookingGuidance("What are the swimming rates?"), /7,500/);
  assert.match(instructionForGuestBookings([], true, rates), /4,321/);
  assert.doesNotMatch(resortContext, /7,500|14,500|15,000/);
});

function bookingHarness({ version = 2, insertError = null, manual = false, services = [], conflict = false, registered = false, permitted = true, times } = {}) {
  const writes = [];
  const rates = copy(); rates.weekday.day = { baseRate: 4321.25, addOnPerHead: 123.45 };
  const client = {
    ...db({ version, rates, times }),
    auth: { getUser: async () => ({ data: { user: { id: "guest" } }, error: null }) },
    from: table => {
      let operation = "select";
      const result = () => ({ error: table === "reservations" && operation === "insert" ? insertError : null,
        data: table === "guests" ? (registered ? [{ id: "registered-guest" }] : []) : table === "services" ? services : table === "units" ? { unit_id: "unit", base_price: 1, is_active: true, archived_at: null }
          : table === "walk_in_guests" ? { walk_in_guest_id: "walk-in" }
          : table === "reservations" && operation === "insert" ? { reservation_id: "reservation", reference_number: "TEST", status: "pending" } : null });
      const query = {
        select: () => query, eq: () => query, in: () => query, ilike: () => query, limit: () => query,
        insert: payload => { operation = "insert"; writes.push({ table, payload }); return query; },
        upsert: payload => { operation = "upsert"; writes.push({ table, payload }); return query; },
        update: payload => { operation = "update"; writes.push({ table, payload }); return query; },
        delete: () => { operation = "delete"; writes.push({ table, operation }); return query; },
        maybeSingle: async () => result(), single: async () => result(),
        then: (resolve, reject) => Promise.resolve(result()).then(resolve, reject),
      };
      return query;
    },
  };
  const route = loadTsModule(manual ? "app/api/admin/reservations/create/route.ts" : "app/api/reservations/create/route.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/server/role-permissions": { staffHasPermission: async () => permitted },
    "@/lib/server/admin-audit": { requireActiveStaff: async () => ({ supabase: client, staffUser: { role: "admin" } }), createAuditLog: async () => true },
    "@/lib/server/reservation-availability": { checkReservationOverlap: async () => ({ conflict, error: null }) },
    "@/lib/notifications": { createNotifications: async () => ({ error: null }), NOTIFICATION_AUDIENCES: { reservation: [] } },
  });
  const { LEGAL_POLICY_VERSION } = loadTsModule("lib/legal/policies.ts");
  return { writes, save: (overrides = {}) => route.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({
    bookingMode: "day", startDatetime: "2027-06-14T08:00:00+08:00", endDatetime: "2027-06-14T16:00:00+08:00",
    unitId: "unit", adultCount: 22, childCount: 0, packageRateVersion: 2, bookingPolicyVersion: 1, phoneNumber: "09171234567",
    ...(manual ? { guestType: "walk_in", walkInGuest: { firstName: "Test", lastName: "Guest", email: "test@example.com", phoneNumber: "09123456789", address: "Test address" } } : {}),
    acceptedPoliciesVersion: LEGAL_POLICY_VERSION, ...overrides,
  }) })) };
}

test("reservation creation stamps its schedule and bills server prices rather than submitted totals", async () => {
  const h = bookingHarness();
  const response = await h.save({ totalAmount: 1, packageRates: legacyRates });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).reservation.totalAmount, 4568.15);
  assert.equal(h.writes.find(w => w.table === "reservations").payload.package_rate_version, 2);
  assert.equal(h.writes.find(w => w.table === "transactions").payload.total_amount, 4568.15);
});

test("guest and staff creation accept saved edited slots and reject old clocks without writes", async () => {
  const times = structuredClone(DEFAULT_PACKAGE_TIMES);
  times.day = { start: "09:30", end: "17:00", endDayOffset: 0 };
  for (const manual of [false, true]) {
    const old = bookingHarness({ manual, times });
    assert.equal((await old.save()).status, 400);
    assert.equal(old.writes.length, 0);
    const current = bookingHarness({ manual, times });
    assert.equal((await current.save({ startDatetime: "2027-06-14T09:30:00+08:00", endDatetime: "2027-06-14T17:00:00+08:00" })).status, 201);
    assert.equal(current.writes.find(write => write.table === "reservations").payload.start_datetime, "2027-06-14T09:30:00+08:00");
  }
});

test("stale booking quotes write nothing and an insert-time price change is returned for review", async () => {
  const stale = bookingHarness({ version: 3 });
  assert.equal((await stale.save()).status, 409); assert.equal(stale.writes.length, 0);
  const racing = bookingHarness({ insertError: { code: "40001", message: "Package rates changed. Refresh" } });
  const response = await racing.save(); assert.equal(response.status, 409); assert.equal((await response.json()).code, "RATES_CHANGED");
  assert.equal(racing.writes.some(w => w.table === "transactions"), false);
});

test("manual bookings use saved rates and clean up a walk-in profile if prices change during insert", async () => {
  const saved = bookingHarness({ manual: true });
  assert.equal((await saved.save()).status, 201);
  assert.equal(saved.writes.find(w => w.table === "transactions").payload.total_amount, 4568.15);
  const stale = bookingHarness({ manual: true, version: 3 });
  assert.equal((await stale.save()).status, 409); assert.equal(stale.writes.length, 0);
  const racing = bookingHarness({ manual: true, insertError: { code: "40001", message: "Package rates changed" } });
  assert.equal((await racing.save()).status, 409);
  assert.ok(racing.writes.some(w => w.table === "walk_in_guests" && w.operation === "delete"));
  assert.equal(racing.writes.some(w => w.table === "transactions"), false);
});

test("manual service selections use catalog prices, persist quantities, and are included in the actual bill", async () => {
  const h = bookingHarness({ manual: true, services: [{ service_id: "karaoke", price: 500, is_active: true }, { service_id: "chairs", price: 100, is_active: true }] });
  const response = await h.save({ selectedServices: [{ serviceId: "karaoke", quantity: 2, price: 1 }, { serviceId: "chairs", quantity: 3 }], totalAmount: 1 });
  assert.equal(response.status, 201);
  assert.equal(h.writes.find(write => write.table === "transactions").payload.total_amount, 5868.15);
  assert.deepEqual(h.writes.find(write => write.table === "reservation_services").payload.map(row => [row.service_id, row.quantity, row.price_at_time]), [["karaoke", 2, 500], ["chairs", 3, 100]]);
});

test("manual booking rejects invalid quantities, duplicate services and inactive services without saving a reservation", async () => {
  for (const selectedServices of [[{ serviceId: "karaoke", quantity: 0 }], [{ serviceId: "karaoke", quantity: 1.5 }], [{ serviceId: "karaoke", quantity: 10001 }], [{ serviceId: "karaoke" }, { serviceId: "karaoke" }], "invalid"]) {
    const h = bookingHarness({ manual: true }); assert.equal((await h.save({ selectedServices })).status, 400); assert.equal(h.writes.length, 0);
  }
  const h = bookingHarness({ manual: true, services: [{ service_id: "karaoke", price: 500, is_active: false }] });
  assert.equal((await h.save({ selectedServices: [{ serviceId: "karaoke", quantity: 1 }] })).status, 400);
  assert.equal(h.writes.some(write => write.table === "reservations"), false);
});

test("manual booking rechecks conflicts on the server and rejects a slot claimed after the calendar loaded", async () => {
  const h = bookingHarness({ manual: true, conflict: true });
  assert.equal((await h.save()).status, 409);
  assert.equal(h.writes.some(write => write.table === "reservations"), false);
});

test("manual booking rejects existing accounts including a registered email passed as a walk-in", async () => {
  for (const payload of [{ guestType: "existing", guestId: "registered" }, { guestId: "registered" }, { guestEmail: "guest@example.com" }]) {
    const h=bookingHarness({manual:true});const response=await h.save(payload);assert.equal(response.status,400);assert.equal(h.writes.length,0);
    assert.match((await response.json()).message,/own account/);
  }
  const h=bookingHarness({manual:true,registered:true});const response=await h.save();assert.equal(response.status,409);assert.equal(h.writes.length,0);
  assert.match((await response.json()).message,/already has a guest account/);
  const denied=bookingHarness({manual:true,permitted:false});assert.equal((await denied.save()).status,403);assert.equal(denied.writes.length,0);
});

test("manual API accepts ongoing and imminent slots, keeps online lead time and rejects ended staff entries", async () => {
  const originalNow = Date.now;
  Date.now = () => Date.parse("2027-06-14T12:00:00+08:00");
  try {
    const ongoing = bookingHarness({ manual: true });
    assert.equal((await ongoing.save()).status, 201);
    assert.equal(ongoing.writes.find(write => write.table === "reservations").payload.start_datetime, "2027-06-14T08:00:00+08:00");
    const online = bookingHarness();
    assert.equal((await online.save({ booking_type: "walk_in" })).status, 400);
    assert.equal(online.writes.length, 0);
    const times = structuredClone(DEFAULT_PACKAGE_TIMES);
    times.day = { start: "12:15", end: "16:00", endDayOffset: 0 };
    const imminent = bookingHarness({ manual: true, times });
    assert.equal((await imminent.save({ startDatetime: "2027-06-14T12:15:00+08:00" })).status, 201);
    const onlineSoon = bookingHarness({ times });
    assert.equal((await onlineSoon.save({ startDatetime: "2027-06-14T12:15:00+08:00" })).status, 400);
    assert.equal(onlineSoon.writes.length, 0);
    Date.now = () => Date.parse("2027-06-14T16:00:00+08:00");
    const ended = bookingHarness({ manual: true });
    assert.equal((await ended.save()).status, 400);
    assert.equal(ended.writes.length, 0);
  } finally { Date.now = originalNow; }
});

test("guest booking and manual entry reject malformed contact numbers before creating any records", async () => {
  for (const phone of ["1234567", "+649171234567", "+6309171234567", "0917ABC4567"]) {
    const guest = bookingHarness(); assert.equal((await guest.save({ phoneNumber: phone })).status, 400); assert.equal(guest.writes.length, 0);
    const staff = bookingHarness({ manual: true });
    assert.equal((await staff.save({ walkInGuest: { firstName: "Test", lastName: "Guest", email: "test@example.com", address: "Taytay", phoneNumber: phone } })).status, 400);
    assert.equal(staff.writes.length, 0);
  }
  const guest = bookingHarness(); assert.equal((await guest.save({ phoneNumber: "0917-123-4567" })).status, 201);
  assert.deepEqual(guest.writes.find(write => write.table === "guests").payload, { phone_number: "+639171234567" });
  const staff = bookingHarness({ manual: true }); assert.equal((await staff.save()).status, 201);
  assert.equal(staff.writes.find(write => write.table === "walk_in_guests").payload.phone_number, "+639123456789");
});
