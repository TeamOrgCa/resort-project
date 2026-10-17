import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/catalog" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { DEFAULT_PACKAGE_TIMES } = loadTsModule("lib/booking/package-times.ts");
after(() => dom.window.close());

test("admin can edit a slot, save it, and restore both prices and original times before publishing", async () => {
  const originalFetch = globalThis.fetch, writes = [];
  const times = structuredClone(DEFAULT_PACKAGE_TIMES); times.day = { start: "10:00", end: "18:00", endDayOffset: 0 };
  const rates = structuredClone(legacyRates); rates.weekday.day.baseRate = 9999;
  globalThis.fetch = async (_url, options) => {
    if (!options?.method) return Response.json({ schedule: { version: 7, rates, times }, defaultRates: legacyRates });
    const body = JSON.parse(options.body); writes.push(body);
    return Response.json({ schedule: { version: 8 + writes.length, rates: body.rates, times: body.times }, message: "Saved" });
  };
  const Component = loadTsModule("components/admin/catalog/PackageRatesEditor.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const field = label => container.querySelector(`[aria-label="${label}"]`);
  try {
    await act(async () => root.render(createElement(Component)));
    const start = field("Day swimming start time");
    assert.equal(start.value, "10:00");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(start, "11:00");
      start.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const submit = async () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    await submit();
    assert.equal(writes[0].times.day.start, "11:00");
    assert.equal(writes[0].expectedVersion, 7);
    const restore = [...container.querySelectorAll("button")].find(button => button.textContent === "Restore defaults");
    await act(async () => restore.click());
    assert.equal(writes.length, 1, "restore fills the form without publishing");
    assert.equal(field("Day swimming start time").value, "08:00");
    assert.equal(field("Night swimming end time").value, "06:00");
    assert.equal(field("weekday Day swimming package price").value, "7500");
    await submit();
    assert.deepEqual(writes[1].times, DEFAULT_PACKAGE_TIMES);
    assert.deepEqual(writes[1].rates, legacyRates);
    assert.equal(writes[1].expectedVersion, 9);
  } finally {
    await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch;
  }
});
