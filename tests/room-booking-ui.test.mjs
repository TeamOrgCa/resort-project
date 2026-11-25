import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/booking" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

test("room stays reveal durations after date selection and carry available 3-hour and 12-hour windows forward", async () => {
  const savedFetch = globalThis.fetch;
  const realNow = Date.now;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const [year, monthNumber] = today.split("-").map(Number);
  const month = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
  const selectedWindows = [], navigations = [];
  globalThis.fetch = async url => url.startsWith("/api/ocular-time-slots") ? Response.json({ slots: [] }) : Response.json({
    rooms: [{room_id:"S01",classification_id:"standard",unavailable:false,blocks:[
      {start_datetime:`${month}-05T00:00:00+08:00`,end_datetime:`${month}-05T10:00:00+08:00`},
      {start_datetime:`${month}-05T13:00:00+08:00`,end_datetime:`${month}-06T08:00:00+08:00`},
      {start_datetime:`${month}-07T00:00:00+08:00`,end_datetime:`${month}-08T00:00:00+08:00`}
    ]},{room_id:"S02",classification_id:"standard",private_swimming_only:true,unavailable:false,blocks:[]}],
    reservations: [{ start_datetime: `${month}-05T00:00:00+08:00`, end_datetime: `${month}-05T10:00:00+08:00` }],
    blockedDates: [
      { start_date: `${month}-05`, end_date: `${month}-06`, start_datetime: `${month}-05T13:00:00+08:00`, end_datetime: `${month}-06T08:00:00+08:00` },
      { start_date: `${month}-07`, end_date: `${month}-07` },
    ],
    maxBookingDate: `${month}-20`,
  });
  const Component = loadTsModule("app/booking/page.tsx", {
    "next/link": ({ children, href }) => createElement("a", { href }, children),
    "next/image": ({ src, alt }) => createElement("img", { src, alt }),
    "next/navigation": { useRouter: () => ({ push: path => navigations.push(path) }) },
    "@/components/Navigation": () => null,
    "@/components/Footer": () => null,
    "@/components/booking/BookingGuide": () => null,
    "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule: { version: 1, rates: legacyRates }, error: null }) },
    "@/lib/stores/booking-store": { useBookingStore: selector => selector({
      setBookingWindow: (...args) => selectedWindows.push(args), setBookingDraft() {}, resetBookingDraft() {},
    }) },
  }).default;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = async element => {
    assert.ok(element);
    assert.equal(element.disabled, false);
    await act(async () => element.click());
  };
  const date = day => host.querySelector(`[aria-label^="${month}-${day}:"]`);
  const duration = hours => [...host.querySelectorAll('[data-booking-guide="room-times"] button')].find(button => button.querySelector("span").textContent === `${hours} hours`);
  const next = () => host.querySelector('[data-booking-guide="dates-continue"]');
  const changeCheckIn = async value => {
    const input = host.querySelector("#room-check-in-time");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(createElement(Component)));
    await click(host.querySelector('[aria-labelledby="booking-option-room"]'));
    assert.equal(host.querySelector('[data-booking-guide="booking-mode"]'), null);
    assert.doesNotMatch(host.querySelector('[data-booking-guide="date-summary"]').textContent,/Rate Information|base package|package rate/);
    assert.equal(host.querySelector('[data-booking-guide="room-times"]'), null);
    assert.equal(next().disabled, true);
    await click(host.querySelector('[aria-label="Next month"]'));
    assert.equal(date("07").disabled, true);
    assert.equal(date("21").disabled, true);

    await click(date("06"));
    assert.ok(host.querySelector('[data-booking-guide="room-times"]'));
    assert.equal(next().disabled, true, "a date alone cannot continue without a duration");
    await click(duration(12));
    assert.equal(duration(12).getAttribute("aria-pressed"), "true");
    assert.equal(host.querySelectorAll('#room-check-in-time option[value]:not([value=""])').length, 48);
    for (const [value, label] of [["00:00", "12:00 AM"], ["10:30", "10:30 AM"], ["12:00", "12:00 PM"], ["23:30", "11:30 PM"]]) {
      assert.equal(host.querySelector(`#room-check-in-time option[value="${value}"]`).textContent, label);
    }
    assert.equal(host.querySelector('#room-check-in-time option[value="23:30"]').disabled, true);
    await changeCheckIn("23:30");
    assert.equal(next().disabled, true, "overnight stays respect maintenance on the next day");
    assert.match(host.querySelector('[data-booking-guide="room-times"] [role="alert"]').textContent, /overlaps/);
    await click(date("08"));
    await click(duration(12));
    await changeCheckIn("23:30");
    assert.match(host.querySelector('[data-booking-guide="date-summary"]').textContent, /12 hours/);
    await click(next());
    assert.equal(selectedWindows[0][0], "custom");
    assert.equal(selectedWindows[0][1], `${month}-08T15:30:00.000Z`);
    assert.equal(selectedWindows[0][2], `${month}-09T03:30:00.000Z`);
    assert.equal(selectedWindows[0][3].customEndDate, `${month}-09`);
    assert.equal(selectedWindows[0][3].customDurationHours, 12);

    await click(duration(3));
    await click(next());
    assert.equal(selectedWindows[1][1], `${month}-08T15:30:00.000Z`);
    assert.equal(selectedWindows[1][2], `${month}-08T18:30:00.000Z`);
    assert.equal(selectedWindows[1][3].customEndDate, `${month}-09`);
    assert.equal(selectedWindows[1][3].customDurationHours, 3);
    await changeCheckIn("00:00");
    await click(next());
    assert.equal(selectedWindows[2][1], `${month}-07T16:00:00.000Z`);
    assert.equal(selectedWindows[2][2], `${month}-07T19:00:00.000Z`);
    assert.equal(selectedWindows[2][3].customEndDate, `${month}-08`);

    await click(date("05"));
    assert.equal(duration(12).disabled, true, "a 12-hour stay cannot overlap a reservation or maintenance");
    assert.equal(next().disabled, true, "changing dates clears the selected duration");
    assert.equal(host.querySelector("#room-check-in-time"), null);
    await click(duration(3));
    assert.equal(host.querySelector("#room-check-in-time").value, "10:00");
    await changeCheckIn("12:00");
    assert.equal(next().disabled, true, "unavailable check-in times cannot continue even with a forged selection");
    await changeCheckIn("10:00");
    await click(next());
    assert.equal(selectedWindows[3][1], `${month}-05T02:00:00.000Z`);
    assert.equal(selectedWindows[3][2], `${month}-05T05:00:00.000Z`);
    assert.equal(selectedWindows[3][3].customDurationHours, 3);
    assert.deepEqual(navigations, Array(4).fill("/booking/form"));

    // Revalidate on click even if the 15-second UI clock has not ticked yet.
    Date.now = () => Date.parse(`${month}-05T09:00:00+08:00`);
    await act(async () => window.dispatchEvent(new window.Event("focus")));
    assert.equal(host.querySelector('#room-check-in-time option[value="09:30"]').disabled, true);
    assert.equal(host.querySelector('#room-check-in-time option[value="10:00"]').disabled, false);
    assert.equal(next().disabled, false);
    Date.now = () => Date.parse(`${month}-05T09:00:01+08:00`);
    await click(next());
    assert.equal(next().disabled, true, "a stale selection cannot continue after crossing the one-hour boundary");
    assert.equal(host.querySelector('#room-check-in-time option[value="10:00"]').disabled, true);
    assert.match(host.querySelector('[data-booking-guide="room-times"] [role="alert"]').textContent, /at least one hour/);
    assert.equal(navigations.length, 4);
    Date.now = realNow;
    await act(async () => window.dispatchEvent(new window.Event("focus")));

    await click(host.querySelector('[aria-label="Back to booking options"]'));
    await click(host.querySelector('[aria-labelledby="booking-option-private"]'));
    assert.ok(host.querySelector('[data-booking-guide="booking-mode"]'));
    assert.equal(host.querySelector('[data-booking-guide="room-times"]'), null);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    globalThis.fetch = savedFetch;
    Date.now = realNow;
  }
});
