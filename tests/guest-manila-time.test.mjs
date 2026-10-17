import test, { after } from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { JSDOM } from "jsdom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/manage" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());

test("guest receipts use the Philippine issue date on a UTC device", async () => {
  const original = process.env.TZ; process.env.TZ = "UTC";
  const Component = loadTsModule("components/GuestReceipts.tsx", {
    "@/lib/supabase/client": { createClient: () => ({ from(table) {
      const q = { select: () => q, in: () => q, eq: () => q, order: () => q,
        then: (yes, no) => Promise.resolve({ data: table === "payments" ? [{ payment_id: "p", reservation_id: "r" }]
          : [{ receipt_id: "receipt", payment_id: "p", receipt_number: "RCPT-PH", issued_at: "2026-10-16T16:30:00Z", amount_paid: 500 }], error: null }).then(yes, no) }; return q;
    } }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component, { bookings: [{ id: "r", reference: "MV-TEST" }] })));
    assert.match(container.textContent, /Oct 17, 2026.*12:30 AM/);
    assert.doesNotMatch(container.textContent, /Oct 16/);
  } finally {
    await act(async () => root.unmount()); container.remove(); if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});

test("ocular dates are validated against the Philippine day and reject impossible calendar dates", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-16T16:30:00Z") });
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      let catalogReads = 0, authReads = 0;
      const mocks = {
        "@/lib/supabase/server": { createClient: async () => ({ auth: { getUser: async () => { authReads++; return { data: { user: null } }; } } }) },
        "@/repositories/catalogRepository": { getActiveOcularSlots: async () => { catalogReads++; return []; } },
        "@/lib/email": { sendOcularVisitScheduledEmail: async () => {} },
      };
      const create = loadTsModule("app/api/ocular-visits/route.ts", mocks).POST;
      const reschedule = loadTsModule("app/api/ocular-visits/reschedule/route.ts", mocks).POST;
      const request = scheduledDate => new Request("http://localhost", { method: "POST", body: JSON.stringify({ scheduledDate, timeSlot: "09:00-10:00", visitId: "visit", timeSlotId: "slot" }) });
      for (const date of ["2026-10-16", "2027-02-30", "2026-10-17T09:00:00Z"]) {
        assert.equal((await create(request(date))).status, 400);
        assert.equal((await reschedule(request(date))).status, 400);
      }
      assert.equal(catalogReads, 0); assert.equal(authReads, 0);
      await create(request("2026-10-17")); assert.equal(catalogReads, 1, "today passes date validation before slot lookup");
      assert.equal((await reschedule(request("2026-10-17"))).status, 401, "today passes date validation before authentication");
      assert.equal(authReads, 1);
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
