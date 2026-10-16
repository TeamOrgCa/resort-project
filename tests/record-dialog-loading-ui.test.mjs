import test from "node:test";
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { renderToString } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const Dialog = loadTsModule("components/manage/RecordDialog.tsx").default;
const ErrorDialog = loadTsModule("components/ui/FormErrorDialog.tsx").default;
const props = { title: "Reservation details", reference: "MV-TEST", busy: false, onClose: () => {} };
const element = extra => createElement(Dialog, { ...props, ...extra }, createElement("button", null, "Edit booking"));

test("reservation and error dialogs render safely without a browser", () => {
  assert.equal(typeof document, "undefined");
  const html = renderToString(element());
  assert.match(html, /Opening reservation details/);
  assert.match(html, /role="status"/);
  assert.equal(renderToString(createElement(ErrorDialog, { title: "Invalid input", message: "Please check the form", onClose: () => {} })), "");
});

const calendar = client => loadTsModule("components/admin/ReservationCalendar.tsx", {
  "@/lib/supabase/client": { createClient: () => client },
  "@/components/admin/ManualBookingDialog": { __esModule: true, default: () => null },
  "@/components/admin/ReservationEditor": { __esModule: true, default: () => createElement("p", null, "Reservation editor") },
  "next/image": { __esModule: true, default: () => null },
  "next/link": { __esModule: true, default: ({ children, ...attrs }) => createElement("a", attrs, children) },
}).default;

test("opening a reservation deep link during server rendering shows loading instead of crashing", () => {
  assert.equal(typeof document, "undefined");
  const Calendar = calendar(null);
  const html = renderToString(createElement(Calendar, { initialReservationId: "11111111-1111-4111-8111-111111111111", initialDate: "2026-10-17", initialAccess: { role: "admin", permissions: [] } }));
  assert.match(html, /Opening reservation details/);
  assert.match(html, /Loading reservation calendar/);
  assert.doesNotMatch(html, /Fully booked/);
});

async function browser(run) {
  const dom = new JSDOM("<!doctype html><html><body><button id='opener'>View booking</button><div id='host'></div></body></html>", { url: "http://localhost/admin/reservations" });
  for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  try { await run(dom); }
  finally {
    dom.window.close();
    for (const key of ["window", "document", "HTMLElement", "Node", "IS_REACT_ACT_ENVIRONMENT"]) delete globalThis[key];
  }
}

test("server-rendered dialog hydrates without mismatches, manages focus and shows progress while saving", async () => {
  const html = renderToString(element());
  await browser(async () => {
    const { hydrateRoot } = await import("react-dom/client");
    const host = document.getElementById("host"), opener = document.getElementById("opener");
    host.innerHTML = html; opener.focus();
    const errors = []; let root, closed = 0;
    const onClose = () => closed++;
    await act(async () => { root = hydrateRoot(host, element({ onClose }), { onRecoverableError: error => errors.push(error) }); });
    try {
      const dialog = document.querySelector('[role="dialog"]');
      assert.ok(dialog); assert.equal(dialog.closest("#host"), null);
      assert.equal(document.activeElement.getAttribute("aria-label"), "Close booking dialog");
      assert.equal(document.body.style.overflow, "hidden"); assert.deepEqual(errors, []);
      const buttons = dialog.querySelectorAll("button"); buttons[buttons.length - 1].focus();
      await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
      assert.equal(document.activeElement, buttons[0]);
      await act(async () => root.render(element({ busy: true, onClose })));
      assert.match(dialog.textContent, /Processing your request/);
      assert.equal(dialog.getAttribute("aria-busy"), "true");
      assert.equal(dialog.querySelector('[aria-label="Close booking dialog"]').disabled, true);
      assert.equal(dialog.querySelector("fieldset").disabled, true);
      await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(closed, 0);
      await act(async () => root.render(element({ onClose })));
      assert.doesNotMatch(dialog.textContent, /Processing your request/);
      await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(closed, 1);
    } finally { await act(async () => root.unmount()); }
    assert.equal(document.activeElement, opener); assert.equal(document.body.style.overflow, "");
  });
});

test("calendar shows a clear pending state until its request finishes", async () => {
  await browser(async () => {
    const { createRoot } = await import("react-dom/client");
    let release;
    const savedFetch = globalThis.fetch;
    globalThis.fetch = () => new Promise(resolve => { release = () => resolve(Response.json({ blocks: [] })); });
    const query = { select: () => query, neq: () => query, lt: () => query, gt: () => query, gte: () => query, order: () => query, limit: () => query,
      then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject) };
    const Calendar = calendar({ from: () => query });
    const host = document.getElementById("host"), root = createRoot(host);
    try {
      await act(async () => root.render(createElement(Calendar, { initialAccess: { role: "admin", permissions: [] }, initialDate: "2026-10-17" })));
      assert.match(host.textContent, /Loading reservation calendar/);
      assert.match(host.textContent, /Checking availability/);
      assert.doesNotMatch(host.textContent, /Fully booked/);
      assert.equal(host.querySelector('[aria-label="Refresh calendar"]').disabled, true);
      await act(async () => release());
      assert.doesNotMatch(host.textContent, /Loading reservation calendar|Checking availability/);
      assert.equal(host.querySelector('[aria-label="Refresh calendar"]').disabled, false);
    } finally { await act(async () => root.unmount()); globalThis.fetch = savedFetch; }
  });
});
