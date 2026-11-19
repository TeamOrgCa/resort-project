import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/users" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
async function value(el, next) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype, "value").set.call(el, next);
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function mount() {
  const submissions = [];
  const Component = loadTsModule("components/admin/users/CreateStaffDialog.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const render = (isOpen = true) => act(async () => root.render(createElement(Component, { isOpen, isSubmitting: false, error: "", onClose() {}, onSubmit: data => submissions.push(data) })));
  await render();
  await value(container.querySelector('input[placeholder="Alex Mendoza"]'), "Alex Mendoza");
  await value(container.querySelector('input[type="password"]'), "secret123");
  return { container, submissions, render, email: () => container.querySelector('input[aria-label="Email username"]'),
    submit: () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))),
    close: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test("invalid staff email stays beside the focused field and cannot submit; a corrected address is normalized", async () => {
  const h = await mount();
  try {
    await value(h.email(), "alex@localhost"); await h.submit();
    assert.equal(h.submissions.length, 0); assert.equal(document.activeElement, h.email());
    assert.equal(h.email().getAttribute("aria-invalid"), "true");
    const message = document.getElementById(h.email().getAttribute("aria-describedby")); assert.match(message.textContent, /valid email address/);
    assert.equal(message.getAttribute("role"), "alert"); assert.equal(message, h.email().parentElement.nextElementSibling);
    await value(h.email(), "Alex.Mendoza+desk@MARVILLERESORT.COM"); assert.equal(h.email().getAttribute("aria-invalid"), "false");
    await h.submit(); assert.equal(h.submissions.length, 1); assert.equal(h.submissions[0].email, "alex.mendoza+desk@marvilleresort.com");
    assert.equal(h.submissions[0].role, "staff"); assert.equal(h.submissions[0].password, "secret123");
  } finally { await h.close(); }
});

test("native invalid events show the same field message, and reopening clears stale email errors", async () => {
  const h = await mount();
  try {
    await value(h.email(), "alex@");
    await act(async () => h.email().dispatchEvent(new window.Event("invalid", { cancelable: true })));
    assert.match(h.container.querySelector('[role="alert"]').textContent, /valid email address/); assert.equal(document.activeElement, h.email());
    assert.equal(h.email().required, true); assert.equal(h.email().maxLength, 64);
    await h.render(false); await h.render(true);
    assert.equal(h.email().value, ""); assert.equal(h.email().getAttribute("aria-invalid"), "false");
    assert.equal(h.container.querySelector('[role="alert"]'), null);
  } finally { await h.close(); }
});

test("staff full name removes numbers and emojis and cannot submit an empty or punctuation-only name", async () => {
  const h = await mount();
  try {
    await value(h.email(), "staff");
    const name = h.container.querySelector('input[placeholder="Alex Mendoza"]');
    await value(name, "José 123 Peña 😀"); assert.equal(name.value, "José  Peña ");
    await h.submit(); assert.equal(h.submissions[0].fullName, "José Peña");
    for (const next of ["123😀", "---"]) {
      await value(name, next); await h.submit();
      assert.equal(h.submissions.length, 1); assert.match(h.container.querySelector('[role="alert"]').textContent, /Names must use letters/);
    }
  } finally { await h.close(); }
});


test("staff creation shows the role suffix, preserves the username when switching roles and submits the full email", async () => {
  const h = await mount();
  try {
    await value(h.email(), "alex");
    for (const role of ["staff", "cashier", "admin", "staff"]) {
      await value(h.container.querySelector("select"), role);
      const suffix = role === "admin" ? "@gmail.com" : "@marvilleresort.com";
      assert.equal(h.email().value, "alex");
      assert.equal(h.email().parentElement.querySelector('[aria-hidden="true"]').textContent, suffix);
      await h.submit();
      assert.equal(h.submissions.at(-1).email, "alex" + suffix);
      assert.equal(h.submissions.at(-1).role, role);
    }
  } finally { await h.close(); }
});

test("pasting full addresses preserves valid usernames and rejects wrong domains or overlong mailboxes", async () => {
  const h = await mount();
  const paste = text => act(async () => {
    const event = new window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
    h.email().dispatchEvent(event);
  });
  try {
    const name = "a".repeat(64);
    await paste(name + "@MARVILLERESORT.COM"); assert.equal(h.email().value, name);
    await h.submit(); assert.equal(h.submissions[0].email, name + "@marvilleresort.com");
    for (const email of ["alex@gmail.com", "alex@marvilleresort.com.evil.com", "a".repeat(65) + "@marvilleresort.com"]) {
      await paste(email); await h.submit(); assert.equal(h.submissions.length, 1);
      assert.equal(h.email().getAttribute("aria-invalid"), "true");
    }
    await value(h.container.querySelector("select"), "admin");
    await paste("Owner@GMAIL.COM"); await h.submit();
    assert.equal(h.submissions.at(-1).email, "owner@gmail.com");
  } finally { await h.close(); }
});
