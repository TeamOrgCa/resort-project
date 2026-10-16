import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { createPortal } from "react-dom";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const name of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLFormElement", "Event"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const Guard = loadTsModule("components/TextInputGuard.tsx").default;
after(() => dom.window.close());

async function mount() {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  let submitted = 0;
  function Fixture() {
    const [name, setName] = useState("Guest"), [notes, setNotes] = useState("");
    return createElement("div", null, createElement(Guard),
      createElement("form", { onSubmit: event => { event.preventDefault(); submitted++; } },
        createElement("input", { "aria-label": "Guest name", value: name, onChange: event => setName(event.target.value) }),
        createElement("input", { "aria-label": "Password", type: "password", defaultValue: "secret123" }),
        createElement("button", { type: "submit" }, "Save")),
      createElement("output", { "aria-label": "Guest value" }, name),
      createPortal(createElement("div", { role: "dialog" },
        createElement("textarea", { "aria-label": "Admin notes", value: notes, onChange: event => setNotes(event.target.value) }),
        createElement("output", { "aria-label": "Admin value" }, notes)), document.body));
  }
  await act(async () => root.render(createElement(Fixture)));
  return { container, submitted: () => submitted, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}
const field = label => document.querySelector(`[aria-label="${label}"]`);
async function nativeInput(input, value, composing = false) {
  await act(async () => {
    const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(input, value);
    input.dispatchEvent(new window.InputEvent("input", { bubbles: true, isComposing: composing }));
  });
}

test("client fields and admin portal fields reject emoji typing, paste and drag-and-drop with a visible alert", async () => {
  const h = await mount();
  try {
    for (const label of ["Guest name", "Admin notes", "Password"]) {
      const input = field(label), original = input.value;
      for (const type of ["beforeinput", "paste", "drop"]) {
        const event = type === "beforeinput" ? new window.InputEvent(type, { bubbles: true, cancelable: true, data: "😀" }) : new window.Event(type, { bubbles: true, cancelable: true });
        if (type !== "beforeinput") Object.defineProperty(event, type === "paste" ? "clipboardData" : "dataTransfer", { value: { getData: () => "Hello 😀" } });
        await act(async () => input.dispatchEvent(event)); assert.equal(event.defaultPrevented, true, `${label}: ${type}`);
        assert.equal(input.value, original); assert.match(document.querySelector('[role="alert"]').textContent, /Emojis are not allowed/);
      }
    }
    await act(async () => document.querySelector('[aria-label="Dismiss input notice"]').click()); assert.equal(document.querySelector('[role="alert"]'), null);
  } finally { await h.close(); }
});

test("input fallback synchronizes controlled React values and preserves accents, digits and punctuation", async () => {
  const h = await mount();
  try {
    await nativeInput(field("Guest name"), "José Peña 😀");
    assert.equal(field("Guest name").value, "José Peña "); assert.equal(field("Guest value").textContent, "José Peña ");
    await nativeInput(field("Admin notes"), "Table #12, ₱1,500 👍🏽");
    assert.equal(field("Admin notes").value, "Table #12, ₱1,500 "); assert.equal(field("Admin value").textContent, "Table #12, ₱1,500 ");
    await nativeInput(field("Admin notes"), "Pool day 👨‍👩‍👧‍👦 🇵🇭 1️⃣");
    assert.equal(field("Admin value").textContent, "Pool day   ");
    await act(async () => field("Password").focus()); await nativeInput(field("Password"), "secret123😀");
    assert.equal(field("Password").value, "secret123");
  } finally { await h.close(); }
});

test("IME composition is cleaned on completion and legacy emoji form values cannot be submitted", async () => {
  const h = await mount();
  try {
    await nativeInput(field("Admin notes"), "日本語😀", true);
    await act(async () => field("Admin notes").dispatchEvent(new window.CompositionEvent("compositionend", { bubbles: true, data: "日本語😀" })));
    assert.equal(field("Admin notes").value, "日本語"); assert.equal(field("Admin value").textContent, "日本語");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(field("Guest name"), "Old 😀");
    await act(async () => h.container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(h.submitted(), 0); assert.equal(document.activeElement, field("Guest name"));
  } finally { await h.close(); }
});
