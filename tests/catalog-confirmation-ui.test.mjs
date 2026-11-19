import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/catalog" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const button = (root, label) => [...root.querySelectorAll("button")].find(el => el.textContent.trim() === label);
const click = async el => { assert.ok(el); assert.notEqual(el.disabled, true); await act(async () => el.click()); };
async function value(el, next) {
  await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, next); el.dispatchEvent(new window.Event("input", { bubbles: true })); });
}
async function mount(record = { name: "Extra mattress", price: 300, max_quantity: 5, is_active: true }) {
  const Component = loadTsModule("components/admin/catalog/CatalogEditorDialog.tsx", { "@/components/admin/ContentImageEditor": () => null, "@/components/booking/ServicePhoto": () => null }).default;
  const c = document.createElement("div"); document.body.append(c); const root = createRoot(c); const saves = []; let closes = 0;
  const render = (busy = false, error = null) => act(async () => root.render(createElement(Component, {
    resource: "services", record, references: { units: [], paymentMethods: [] }, referencesError: null, busy, error,
    onClose: () => closes++, onSave: async (...args) => { saves.push(args); },
  })));
  await render();
  return { c, saves, render, closes: () => closes,
    submit: () => act(async () => c.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))),
    close: async () => { await act(async () => root.unmount()); c.remove(); } };
}

test("catalog saves need confirmation, keep draft on cancellation, and do not submit twice", async () => {
  const h = await mount();
  try {
    await value(h.c.querySelector('#catalog-name'), "Premium mattress");
    await value(h.c.querySelector('#catalog-max_quantity'), "7");
    await h.submit(); await h.submit(); assert.deepEqual(h.saves, []);
    assert.equal(document.querySelectorAll('[role="alertdialog"]').length, 1);
    await click(button(document.querySelector('[role="alertdialog"]'), "Keep editing"));
    assert.equal(h.c.querySelector('#catalog-name').value, "Premium mattress");
    await h.submit();
    await click(button(document.querySelector('[role="alertdialog"]'), "Confirm save"));
    assert.equal(h.saves.length, 1); assert.equal(h.saves[0][0].name, "Premium mattress"); assert.equal(h.saves[0][0].max_quantity, 7);
    await h.render(false, "A service with this name already exists.");
    assert.match(h.c.querySelector('[role="alert"]').textContent, /name already exists/);
    assert.equal(h.c.querySelector('#catalog-name').value, "Premium mattress");
  } finally { await h.close(); }
});

test("outside clicks keep an untouched editor open and dirty outside/Cancel/close/Escape actions ask before discarding", async () => {
  const h = await mount();
  try {
    await click(h.c.querySelector('[role="dialog"]'));
    assert.equal(h.closes(), 0); assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await value(h.c.querySelector('#catalog-name'), "Changed name");
    const actions = [
      () => click(h.c.querySelector('[role="dialog"]')),
      () => click(button(h.c, "Cancel")),
      () => click(h.c.querySelector('[aria-label="Close dialog"]')),
      () => act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))),
    ];
    for (const action of actions) {
      await action();
      assert.match(document.querySelector('[role="alertdialog"]').textContent, /Discard unsaved changes/);
      assert.equal(h.closes(), 0);
      await click(button(document.querySelector('[role="alertdialog"]'), "Keep editing"));
      assert.equal(h.c.querySelector('#catalog-name').value, "Changed name");
    }
    await actions[0]();
    await click(button(document.querySelector('[role="alertdialog"]'), "Discard changes"));
    assert.equal(h.closes(), 1); assert.deepEqual(h.saves, []);
  } finally { await h.close(); }
});

test("reverting edits is clean, and a saving editor cannot be dismissed or submitted", async () => {
  const h = await mount();
  try {
    await value(h.c.querySelector('#catalog-max_quantity'), "7"); await value(h.c.querySelector('#catalog-max_quantity'), "5");
    await click(button(h.c, "Cancel")); assert.equal(h.closes(), 1); assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await h.render(true);
    await click(h.c.querySelector('[role="dialog"]'));
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    await h.submit();
    assert.equal(h.closes(), 1); assert.deepEqual(h.saves, []);
    assert.equal(button(h.c, "Cancel").disabled, true); assert.equal(h.c.querySelector('[aria-label="Close dialog"]').disabled, true);
  } finally { await h.close(); }
});

test("new catalog items also require confirmation and validation failures keep the form", async () => {
  const h = await mount(null);
  try {
    await h.submit(); assert.equal(document.querySelector('[role="alertdialog"]'), null); assert.equal(h.saves.length, 0);
    await value(h.c.querySelector('#catalog-name'), "New service"); await value(h.c.querySelector('#catalog-price'), "400");
    await h.submit();
    await click(button(document.querySelector('[role="alertdialog"]'), "Confirm add"));
    assert.equal(h.saves.length, 1); assert.equal(h.saves[0][0].max_quantity, 1);
  } finally { await h.close(); }
});
