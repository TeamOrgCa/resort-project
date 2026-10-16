import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/auth/register" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

async function input(container, name, value) {
  const el = container.querySelector('[name="' + name + '"]'); assert.ok(el);
  await act(async () => {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

const popup = () => document.querySelector('[role="alertdialog"]');
const popupButton = () => popup()?.querySelector("button");
async function mount(fetcher) {
  const originalFetch = globalThis.fetch; globalThis.fetch = fetcher;
  const pushes = [];
  const Component = loadTsModule("app/auth/register/page.tsx", {
    "next/image": () => null,
    "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
    "next/navigation": { useRouter: () => ({ push: path => pushes.push(path) }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  for (const [name, value] of Object.entries({ firstName: "Maria", lastName: "Cruz", email: "guest@example.com", phoneNumber: "09171234567", address: "Taytay, Rizal", password: "secret123", confirmPassword: "secret123" })) await input(container, name, value);
  return { container, pushes, submit: () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))),
    close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; } };
}

test("already registered email shows recovery links, keeps the form and allows retry with a different address", async () => {
  const requests = [];
  const h = await mount(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return requests.length === 1
      ? Response.json({ code: "EMAIL_ALREADY_REGISTERED", message: "This email is already registered. Please sign in or reset your password." }, { status: 409 })
      : Response.json({ success: true, needsEmailConfirmation: true, confirmationEmailSent: true });
  });
  const { container } = h;
  try {
    await h.submit();
    const alert = popup(); assert.match(alert.textContent, /already registered/);
    assert.equal(container.contains(alert), false); assert.match(alert.parentElement.className, /fixed inset-0/);
    assert.equal(alert.getAttribute("aria-modal"), "true"); assert.equal(document.body.style.overflow, "hidden");
    assert.equal(alert.querySelector('a[href="/auth/login"]').textContent, "Sign in");
    assert.equal(alert.querySelector('a[href="/auth/forgot"]').textContent, "Reset password");
    assert.equal(document.activeElement, popupButton()); assert.equal(popupButton().textContent, "Use another email");
    assert.ok(container.querySelector("form")); assert.equal(container.querySelector('[name="email"]').value, "guest@example.com");
    assert.doesNotMatch(container.textContent, /Check your email|Resend confirmation email/); assert.deepEqual(h.pushes, []);
    await act(async () => popupButton().click()); assert.equal(popup(), null); assert.equal(document.body.style.overflow, "");
    assert.equal(document.activeElement, container.querySelector('[name="email"]'));
    assert.equal(document.activeElement.getAttribute("aria-invalid"), "true");
    await input(container, "email", "new@example.com"); assert.equal(container.querySelector("#registration-error"), null);
    await h.submit();
    assert.equal(requests[1].body.email, "new@example.com"); assert.equal(popup(), null);
    assert.equal(container.querySelector("h2").textContent, "Check your email"); assert.deepEqual(h.pushes, []);
  } finally { await h.close(); }
});

test("error popups trap keyboard focus, close with Escape and reopen for repeated errors", async () => {
  const h = await mount(async () => Response.json({ code: "EMAIL_ALREADY_REGISTERED", message: "This email is already registered." }, { status: 409 }));
  try {
    for (let i = 0; i < 2; i++) {
      await h.submit(); assert.ok(popup());
      await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
      assert.equal(document.activeElement, popup().querySelector("a"));
      await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
      assert.equal(document.activeElement, popupButton());
      await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(popup(), null); assert.equal(document.activeElement, h.container.querySelector('[name="email"]'));
    }
    assert.equal(h.container.querySelector('[name="firstName"]').value, "Maria");
    const summary = h.container.querySelector("#registration-error"); assert.equal(summary.nextElementSibling.type, "submit");
  } finally { await h.close(); }
});

test("validation and network failures are visible in popups and retain the form values", async () => {
  let requests = 0; const h = await mount(async () => { requests++; throw new Error("Offline"); });
  try {
    await input(h.container, "confirmPassword", "different123"); await h.submit();
    assert.match(popup().textContent, /Passwords do not match/); assert.equal(requests, 0);
    await act(async () => popupButton().click()); assert.equal(document.activeElement, h.container.querySelector('button[type="submit"]'));
    await input(h.container, "confirmPassword", "secret123"); await h.submit();
    assert.match(popup().textContent, /Unable to connect to the server/); assert.equal(requests, 1);
    assert.equal(h.container.querySelector('[name="email"]').value, "guest@example.com");
  } finally { await h.close(); assert.equal(document.body.style.overflow, ""); }
});
