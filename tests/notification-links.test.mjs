import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { notificationActionUrl } = loadTsModule("lib/notification-links.ts");

test("saved, confirmed and rescheduled reservation links retain their correct entity target", () => {
  for (const [entity_type, parameter] of [["reservation", "reservation"], ["payment", "payment"], ["reservation_reschedule", "reschedule"]]) {
    const item = { action_url: "/manage", entity_type, entity_id: "record-id" };
    const expected = `/manage?tab=bookings&${parameter}=record-id`;
    assert.equal(notificationActionUrl(item), expected);
    assert.equal(notificationActionUrl({ ...item, action_url: expected }), expected, "normalizing twice preserves the target");
    assert.equal(notificationActionUrl({ ...item, action_url: "/admin/reservations" }), "/admin/reservations");
    assert.equal(notificationActionUrl({ ...item, action_url: "/reviews" }), "/reviews");
  }
});

test("historical ocular links open Manage Booking without changing staff or unrelated destinations", () => {
  const expected = "/manage?tab=ocular&visit=visit-id";
  for (const action_url of ["/ocular", "/manage", "/manage?tab=ocular&visit=visit-id"]) {
    assert.equal(notificationActionUrl({ action_url, entity_type: "ocular_visit", entity_id: "visit-id" }), expected);
  }
  assert.equal(notificationActionUrl({ action_url: "/ocular" }), "/manage?tab=ocular");
  assert.equal(notificationActionUrl({ action_url: "/admin/records?tab=ocular", entity_type: "ocular_visit", entity_id: "visit-id" }), "/admin/records?tab=ocular");
  assert.equal(notificationActionUrl({ action_url: "/reviews" }), "/reviews");
  for (const action_url of [null, "https://example.com", "//example.com"]) assert.equal(notificationActionUrl({ action_url }), null);
});

test("new ocular notifications link the guest to their visit and retain the staff destination", async () => {
  const saved = [];
  const { createNotifications } = loadTsModule("lib/notifications.ts", {
    "@/lib/supabase/admin": { tryCreateAdminClient: () => ({ from: table => {
      if (table === "notifications") return { insert: async rows => { saved.push(...rows); return { error: null }; } };
      const q = { select: () => q, in: () => q, eq: async () => ({ data: [{ id: "manager", role: "staff" }], error: null }) }; return q;
    } }) },
  });
  await createNotifications({ actorId: "guest", guestId: "guest", staffRoles: ["staff"], title: "Ocular visit scheduled", entityType: "ocular_visit", entityId: "visit-id", guestActionUrl: "/ocular", staffActionUrl: "/admin/reservations" });
  assert.equal(saved.find(row => row.recipient_role === "guest").action_url, "/manage?tab=ocular&visit=visit-id");
  assert.equal(saved.find(row => row.recipient_role === "staff").action_url, "/admin/reservations");
  for (const [entityType, parameter, title] of [["reservation", "reservation", "Booking saved"], ["payment", "payment", "Reservation confirmed"], ["reservation_reschedule", "reschedule", "Reservation rescheduled"]]) {
    saved.length = 0;
    await createNotifications({ actorId: "guest", guestId: "guest", staffRoles: ["staff"], title, entityType, entityId: "record-id", guestActionUrl: "/manage", staffActionUrl: "/admin/reservations" });
    assert.equal(saved.find(row => row.recipient_role === "guest").action_url, `/manage?tab=bookings&${parameter}=record-id`);
    assert.equal(saved.find(row => row.recipient_role === "staff").action_url, "/admin/reservations");
  }
});
