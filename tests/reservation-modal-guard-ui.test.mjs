import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import * as React from "react";
import { flushSync } from "react-dom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/reservations" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const Dialog = loadTsModule("components/manage/RecordDialog.tsx").default;
const click = element => act(async () => { assert.ok(element); element.click(); });
const button = text => [...document.querySelectorAll("button")].find(el => el.textContent === text);
async function mount() {
  let closed = 0;
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  await act(async () => root.render(createElement(Dialog, { title: "Edit reservation", reference: "MV-TEST", busy: false, onClose: () => closed++ },
    createElement("form", null, createElement("label", null, "Guest notes", createElement("input", { defaultValue: "Original", name: "notes" })), createElement("a", { href: "/admin/reports" }, "Reports")))));
  return { closed: () => closed, input: () => document.querySelector('input[name="notes"]'), closeButton: () => document.querySelector('[aria-label="Close booking dialog"]'), close: async () => { await act(async () => root.unmount()); c.remove(); } };
}
async function value(field, next) {
  await act(async () => {
    field.focus();
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, next);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
}
test("reservation dialogs ignore Escape and backdrop clicks and close clean forms only through X", async () => {
  const h = await mount();
  try {
    assert.equal(button("Close"), undefined);
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await click(document.querySelector('[role="dialog"]').parentElement);
    assert.equal(h.closed(), 0);
    await click(h.closeButton()); assert.equal(h.closed(), 1);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
  } finally { await h.close(); }
});
test("changed forms offer Continue Editing and Discard Changes, preserve edits, and guard page unload", async () => {
  const h = await mount();
  try {
    await value(h.input(), "Updated guest notes");
    const unload = new window.Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    await click(h.closeButton()); assert.equal(h.closed(), 0);
    assert.ok(document.querySelector('[role="alertdialog"]'));
    await click(button("Continue Editing")); assert.equal(h.input().value, "Updated guest notes");
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await click(h.closeButton()); await click(button("Discard Changes")); assert.equal(h.closed(), 1);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
  } finally { await h.close(); }
});
test("reverted edits and successfully saved forms do not trigger an unsaved changes prompt", async () => {
  const h = await mount();
  try {
    await value(h.input(), "Changed"); await value(h.input(), "Original");
    await click(h.closeButton()); assert.equal(h.closed(), 1);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await value(h.input(), "Saved notes");
    await act(async () => h.input().dispatchEvent(new window.Event("reservation-form-saved", { bubbles: true })));
    await click(h.closeButton()); assert.equal(h.closed(), 2);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
  } finally { await h.close(); }
});

test("leaving a changed reservation through a module link asks for confirmation before navigating", async () => {
  const h = await mount();
  try {
    await value(h.input(), "Unsaved notes");
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => document.querySelector('a[href="/admin/reports"]').dispatchEvent(event));
    assert.equal(event.defaultPrevented, true);
    assert.ok(document.querySelector('[role="alertdialog"]'));
    await click(button("Continue Editing"));
    assert.equal(window.location.pathname, "/admin/reservations");
    assert.equal(h.input().value, "Unsaved notes");
  } finally { await h.close(); }
});

test("browser history navigation asks before leaving a changed reservation", async () => {
  const navigation = new window.EventTarget(), destinations = [];
  navigation.traverseTo = key => destinations.push(key);
  Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
  const h = await mount();
  try {
    await value(h.input(), "Changed notes");
    const back = () => {
      const event = new window.Event("navigate", { cancelable: true });
      Object.assign(event, { navigationType: "traverse", destination: { key: "previous-page" } });
      navigation.dispatchEvent(event); return event;
    };
    let event; await act(async () => { event = back(); });
    assert.equal(event.defaultPrevented, true);
    await click(button("Continue Editing")); assert.deepEqual(destinations, []);
    await act(async () => back());
    await click(button("Discard Changes")); assert.deepEqual(destinations, ["previous-page"]);
  } finally { await h.close(); delete window.navigation; }
});

test("capture-phase bookkeeping cannot erase a typed character before the browser delivers onChange", async () => {
  const { useReservationFormGuard } = loadTsModule("components/booking/use-reservation-form-guard.tsx", {
    react: { ...React, useState: initial => {
      const [value, setValue] = useState(initial);
      // Force a commit at the checkpoint, as the real browser reproduction did.
      return [value, next => flushSync(() => setValue(next))];
    } },
  });
  let capture;
  function Form() {
    const [value, setValue] = useState("");
    const guard = useReservationFormGuard();
    capture = guard.captureChange;
    return createElement("div", { ref: guard.root }, createElement("input", { value, onChange: event => setValue(event.target.value) }));
  }
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  try {
    await act(async () => root.render(createElement(Form)));
    const field = c.querySelector("input");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, "M");
      capture();
      // A trusted browser event may checkpoint microtasks before its bubble phase.
      await Promise.resolve();
      flushSync(() => {});
      assert.equal(field.value, "M", "capture handlers must not restore the previous controlled value");
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    assert.equal(field.value, "M");
  } finally { await act(async () => root.unmount()); c.remove(); }
});
