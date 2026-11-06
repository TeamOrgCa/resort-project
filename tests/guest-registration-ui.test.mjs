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
    const proto = el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}

const popup = () => document.querySelector('[data-no-auto-scroll] [role="alert"]');
const popupButton = () => popup()?.querySelector("button");
const scrolls = [];
window.HTMLElement.prototype.scrollIntoView = function(options) { scrolls.push({ name: this.getAttribute("name"), options }); };
async function mount(fetcher) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (String(url).startsWith("https://psgc.cloud/api/")) {
      return Promise.resolve(Response.json(String(url).endsWith("/provinces")
        ? [{ code: "0405800000", name: "Rizal" }]
        : [{ code: "0405813000", name: "Taytay", type: "Mun" }]));
    }
    return fetcher(url, options);
  };
  const pushes = [];
  const Component = loadTsModule("app/auth/register/page.tsx", {
    "next/image": () => null,
    "next/link": ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
    "next/navigation": { useRouter: () => ({ push: path => pushes.push(path) }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
  for (const [name, value] of Object.entries({ firstName: "Maria", lastName: "Cruz", email: "guest@example.com", phoneNumber: "09171234567", province: "Rizal", city: "Taytay", streetAddress: "  Block 2, Main Street  ", zipCode: "1920", password: "secret123", confirmPassword: "secret123" })) await input(container, name, value);
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
    assert.equal(requests[0].body.phoneNumber, "+639171234567");
    assert.equal(requests[0].body.address, "Block 2, Main Street, Taytay, Rizal, 1920");
    const alert = popup(); assert.match(alert.textContent, /already registered/);
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(container.contains(alert), true); assert.match(alert.parentElement.className, /fixed inset-x-0 top-4/);
    assert.equal(alert.getAttribute("aria-modal"), null); assert.equal(document.body.style.overflow, "");
    assert.equal(container.querySelector('#registration-error a[href="/auth/login"]').textContent, "Sign in");
    assert.equal(container.querySelector('#registration-error a[href="/auth/forgot"]').textContent, "Reset password");
    assert.equal(document.activeElement, container.querySelector('[name="email"]'));
    assert.equal(scrolls.at(-1).name, "email"); assert.equal(scrolls.at(-1).options.block, "center");
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

test("error toasts allow immediate retries and repeatedly scroll to the invalid field without trapping focus", async () => {
  const h = await mount(async () => Response.json({ code: "EMAIL_ALREADY_REGISTERED", message: "This email is already registered." }, { status: 409 }));
  try {
    const before = scrolls.length;
    for (let i = 0; i < 2; i++) {
      await h.submit(); assert.ok(popup());
      assert.equal(document.activeElement, h.container.querySelector('[name="email"]'));
      assert.equal(document.querySelector('[role="alertdialog"]'), null);
      assert.equal(document.body.style.overflow, "");
    }
    assert.equal(scrolls.length, before + 2);
    await act(async () => popupButton().click()); assert.equal(popup(), null);
    assert.equal(h.container.querySelector('[name="firstName"]').value, "Maria");
    assert.equal(h.container.querySelector('[name="email"]').getAttribute("aria-invalid"), "true");
    const summary = h.container.querySelector("#registration-error"); assert.equal(summary.nextElementSibling.type, "submit");
  } finally { await h.close(); }
});

test("validation toasts reveal the invalid field and network errors retain the form values", async () => {
  let requests = 0; const h = await mount(async () => { requests++; throw new Error("Offline"); });
  try {
    await input(h.container, "confirmPassword", "different123"); await h.submit();
    assert.match(popup().textContent, /Passwords do not match/); assert.equal(requests, 0);
    assert.equal(document.activeElement, h.container.querySelector('[name="confirmPassword"]'));
    assert.equal(scrolls.at(-1).name, "confirmPassword");
    await act(async () => popupButton().click());
    await input(h.container, "confirmPassword", "secret123"); await h.submit();
    assert.match(popup().textContent, /Unable to connect to the server/); assert.equal(requests, 1);
    assert.equal(h.container.querySelector('[name="email"]').value, "guest@example.com");
  } finally { await h.close(); assert.equal(document.body.style.overflow, ""); }
});

test("registration rejects an invalid mobile contact before calling the server", async () => {
  let requests = 0;
  const h = await mount(async () => { requests++; return Response.json({ success: true }); });
  try {
    await input(h.container, "phoneNumber", "917ABC4567"); await h.submit();
    assert.equal(requests, 0);
    assert.match(popup().textContent, /valid Philippine mobile number/);
    assert.equal(document.activeElement, h.container.querySelector('[name="phoneNumber"]'));
    assert.equal(h.container.querySelector('[name="phoneNumber"]').value, "917ABC4567");
  } finally { await h.close(); }
});

test("clicking Create Account with a missing required field shows a toast and scrolls to that field", async () => {
  let requests = 0;
  const h = await mount(async () => { requests++; return Response.json({ success: true }); });
  try {
    await input(h.container, "firstName", "");
    await act(async () => h.container.querySelector('button[type="submit"]').click());
    assert.ok(popup()); assert.equal(document.querySelector('[role="alertdialog"]'), null);
    const field = h.container.querySelector('[name="firstName"]');
    assert.equal(document.activeElement, field); assert.equal(scrolls.at(-1).name, "firstName");
    assert.equal(field.getAttribute("aria-invalid"), "true"); assert.equal(requests, 0);
    await input(h.container, "firstName", "Maria");
    assert.equal(field.hasAttribute("aria-invalid"), false); assert.equal(popup(), null);
  } finally { await h.close(); }
});

test("server field errors reveal the supplied field while retaining the other form values", async () => {
  const h = await mount(async () => Response.json({ message: "Please choose a stronger password.", field: "password" }, { status: 400 }));
  try {
    await h.submit(); assert.match(popup().textContent, /stronger password/);
    assert.equal(document.activeElement, h.container.querySelector('[name="password"]'));
    assert.equal(scrolls.at(-1).name, "password");
    assert.equal(h.container.querySelector('[name="email"]').value, "guest@example.com");
    assert.equal(h.container.querySelector('[name="streetAddress"]').value, "  Block 2, Main Street  ");
  } finally { await h.close(); }
});

test("registration clears the city when province changes and requires a complete address", async () => {
  let requests = 0;
  const h = await mount(async () => { requests++; return Response.json({ success: true }); });
  try {
    await input(h.container, "province", "");
    assert.equal(h.container.querySelector('[name="city"]').value, "");
    assert.equal(h.container.querySelector('[name="city"]').disabled, true);
    await h.submit();
    assert.equal(requests, 0);
    assert.match(popup().textContent, /select your province and city/);
    assert.equal(document.activeElement, h.container.querySelector('[name="province"]'));
    assert.equal(h.container.querySelector('[name="streetAddress"]').value, "  Block 2, Main Street  ");
  } finally { await h.close(); }
});

test("registration applies the field limits and blocks incomplete ZIP codes and short passwords", async () => {
  const requests = [];
  const h = await mount(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ success: true, needsEmailConfirmation: true });
  });
  try {
    for (const name of ["firstName", "middleName", "lastName"]) {
      const field = h.container.querySelector(`[name="${name}"]`);
      assert.equal(field.maxLength, 75);
      await input(h.container, name, "A".repeat(76));
      assert.equal(field.value.length, 75);
    }
    assert.equal(h.container.querySelector('[name="email"]').maxLength, 254);
    assert.equal(h.container.querySelector('[name="streetAddress"]').maxLength, 200);
    for (const name of ["password", "confirmPassword"]) {
      const field = h.container.querySelector(`[name="${name}"]`);
      assert.equal(field.minLength, 8); assert.equal(field.maxLength, 128);
    }
    const zip = h.container.querySelector('[name="zipCode"]');
    assert.equal(zip.maxLength, 4);
    await input(h.container, "zipCode", "123");
    assert.equal(zip.checkValidity(), false);
    await h.submit();
    assert.equal(requests.length, 0);
    assert.match(popup().textContent, /exactly 4 digits/);
    assert.equal(document.activeElement, zip);
    await act(async () => popupButton().click());
    await input(h.container, "zipCode", "0a12345");
    assert.equal(zip.value, "0123");
    assert.equal(zip.checkValidity(), true);
    await input(h.container, "password", "1234567");
    await input(h.container, "confirmPassword", "1234567");
    await h.submit();
    assert.equal(requests.length, 0);
    assert.match(popup().textContent, /at least 8 characters/);
    await act(async () => popupButton().click());
    await input(h.container, "password", "12345678");
    await input(h.container, "confirmPassword", "12345678");
    await h.submit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].address, "Block 2, Main Street, Taytay, Rizal, 0123");
  } finally { await h.close(); }
});

test("registration removes typed and pasted email whitespace before submission", async () => {
  const requests = [];
  const h = await mount(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return Response.json({ success: true, needsEmailConfirmation: true });
  });
  try {
    for (const value of ["guest @example.com", "  guest\u00a0\u200b @example.com  "]) {
      await input(h.container, "email", value);
      assert.equal(h.container.querySelector('[name="email"]').value, "guest@example.com");
    }
    await h.submit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].email, "guest@example.com");
    assert.equal(h.container.querySelector("h2").textContent, "Check your email");
  } finally { await h.close(); }
});

test("registration filters every personal name and preserves accents, initials and name punctuation", async () => {
  const requests = [];
  const h = await mount(async (_url, options) => { requests.push(JSON.parse(options.body)); return Response.json({ success: true, needsEmailConfirmation: true }); });
  try {
    for (const [field, value, expected] of [["firstName", "José123 😀", "José "], ["lastName", "O’Neil Jr. ９1️⃣", "O’Neil Jr. "], ["middleName", "J. 👩‍👩‍👧‍👦٣", "J. "]]) {
      await input(h.container, field, value);
      assert.equal(h.container.querySelector(`[name="${field}"]`).value, expected);
    }
    await h.submit(); assert.equal(requests.length, 1);
  } finally { await h.close(); }
});
