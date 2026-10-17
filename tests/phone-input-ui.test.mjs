import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const PhoneInput = loadTsModule("components/ui/PhilippinePhoneInput.tsx").default;

test("shared phone control shows a fixed country code, accepts pasted formats and exposes invalid input", async () => {
  const values = [];
  function Form() {
    const [value, setValue] = useState("+639171234567");
    return createElement(PhoneInput, { id: "phone", name: "phone", value, onChange: next => { values.push(next); setValue(next); } });
  }
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Form)));
    const field = container.querySelector("input");
    assert.equal(field.value, "9171234567"); assert.match(container.textContent, /\+63/); assert.equal(field.checkValidity(), true);
    for (const input of ["0917 123 4567", "639171234567", "+63 917 123 4567"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, input);
        field.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      assert.equal(field.value, "9171234567"); assert.equal(field.checkValidity(), true);
    }
    for (const input of ["12345", "+6309171234567", "+649171234567", "0917ABC4567"]) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, input);
        field.dispatchEvent(new window.Event("input", { bubbles: true }));
        field.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
      });
      assert.equal(field.checkValidity(), false, input);
      assert.equal(field.getAttribute("aria-invalid"), "true");
      assert.match(container.querySelector('[role="alert"]').textContent, /Philippine mobile/);
    }
    assert.equal(values.includes("917ABC4567"), true, "letters are preserved for rejection");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
