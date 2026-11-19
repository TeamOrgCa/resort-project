import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const findButton = (container, text) => [...container.querySelectorAll("button")].find(button => button.textContent.trim() === text);
async function click(button) {
  assert.ok(button); assert.equal(button.disabled, false);
  await act(async () => button.click());
}

async function mount({ user = null, staff = false, expired = false } = {}) {
  const saved = globalThis.fetch, posts = [];
  let authChecks = 0;
  const client = {
    auth: { getUser: async () => { authChecks++; return { data: { user }, error: null }; } },
    from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: staff ? { id: user.id } : null, error: null }) }; return q; },
  };
  globalThis.fetch = async (url, options) => {
    if (url.startsWith("/api/ocular-time-slots")) return Response.json({ slots: [{ start_time: "09:00", end_time: "10:00" }], unavailableByDate: {} });
    if (url.startsWith("/api/booking/availability")) return Response.json({ reservations: [], blockedDates: [] });
    if (url === "/api/ocular-visits") {
      posts.push(JSON.parse(options.body));
      return expired ? Response.json({ success: false, message: "Unauthorized" }, { status: 401 })
        : Response.json({ success: true, ocularVisit: { reference: "OV-TEST" } });
    }
    throw Error(`Unexpected request: ${url}`);
  };
  const Component = loadTsModule("app/booking/page.tsx", {
    "next/link": ({ children, href }) => createElement("a", { href }, children),
    "next/image": ({ src, alt }) => createElement("img", { src, alt }),
    "next/navigation": { useRouter: () => ({ push() {} }) },
    "@/components/Navigation": () => null, "@/components/Footer": () => null, "@/components/booking/BookingGuide": () => null,
    "@/lib/supabase/client": { createClient: () => client },
    "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 1, rates: legacyRates }, error: null }) },
    "@/lib/stores/booking-store": { useBookingStore: selector => selector({ setBookingWindow() {}, setBookingDraft() {}, resetBookingDraft() {} }) },
  }).default;
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  await act(async () => root.render(createElement(Component)));
  await click(findButton(c, "Ocular Visit"));
  await click(c.querySelector('[aria-label="Next month"]'));
  await click(findButton(c.querySelector('[data-booking-guide="dates-calendar"]'), "5"));
  await click(c.querySelector('[data-booking-guide="ocular-times"] button'));
  return { c, posts, authChecks: () => authChecks, close: async () => { await act(async () => root.unmount()); c.remove(); globalThis.fetch = saved; } };
}

test("signed-out visitors get a dismissible login toast before ocular confirmation or submission", async () => {
  const h = await mount();
  try {
    await click(findButton(h.c, "Schedule Visit"));
    assert.match(document.querySelector('[role="alert"]').textContent, /Please log in first to schedule an ocular visit/);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(h.authChecks(), 1); assert.deepEqual(h.posts, []);
    assert.ok(h.c.querySelector('[data-booking-guide="ocular-times"]'));
    await click(document.querySelector('[aria-label="Dismiss ocular visit notification"]'));
    assert.equal(document.querySelector('[role="alert"]'), null);
  } finally { await h.close(); }
});

test("staff accounts are treated as visitors when scheduling from the customer side", async () => {
  const h = await mount({ user: { id: "staff" }, staff: true });
  try {
    await click(findButton(h.c, "Schedule Visit"));
    assert.match(document.querySelector('[role="alert"]').textContent, /Please log in first/);
    assert.equal(document.querySelector('[role="alertdialog"]'), null); assert.deepEqual(h.posts, []);
  } finally { await h.close(); }
});

test("signed-in guests still confirm the ocular schedule before it is saved", async () => {
  const h = await mount({ user: { id: "guest" } });
  try {
    await click(findButton(h.c, "Schedule Visit"));
    assert.deepEqual(h.posts, []); assert.equal(document.querySelector('[role="alert"]'), null);
    await click(findButton(document.querySelector('[role="alertdialog"]'), "Confirm schedule"));
    assert.equal(h.posts.length, 1); assert.equal(h.posts[0].timeSlot, "09:00-10:00");
    assert.match(h.c.textContent, /Visit Scheduled!/);
  } finally { await h.close(); }
});

test("a session that expires after confirmation also shows the login toast and keeps the selected slot", async () => {
  const h = await mount({ user: { id: "guest" }, expired: true });
  try {
    await click(findButton(h.c, "Schedule Visit"));
    await click(findButton(document.querySelector('[role="alertdialog"]'), "Confirm schedule"));
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.match(document.querySelector('[role="alert"]').textContent, /Please log in first/);
    assert.ok(findButton(h.c, "Schedule Visit")); assert.equal(h.posts.length, 1);
    assert.ok(h.c.querySelector('[data-booking-guide="ocular-times"]'));
  } finally { await h.close(); }
});
