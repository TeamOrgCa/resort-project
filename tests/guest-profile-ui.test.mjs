import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/profile" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

test("profile filters every name and saves through server validation without changing address digits", async () => {
  const requests = [], originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { requests.push({ url, ...options, body: JSON.parse(options.body) }); return Response.json({ success: true }); };
  const router = { push() {} };
  const client = { auth: { getUser: async () => ({ data: { user: { id: "guest" } } }) }, from: () => {
    const q = { select: () => q, eq: () => q, single: async () => ({ data: { first_name: "Maria", last_name: "Cruz", phone_number: "+639171234567", email: "guest@example.com", address: "Block 2, Manila" } }) }; return q;
  } };
  const Component = loadTsModule("app/profile/page.tsx", {
    "@/lib/supabase/client": { createClient: () => client },
    "next/navigation": { useRouter: () => router },
    "@/components/Navigation": () => null, "@/components/Footer": () => null,
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const input = async (name, value) => act(async () => {
    const field = container.querySelector(`[name="${name}"]`);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, value);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  const submit = () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  try {
    await act(async () => root.render(createElement(Component)));
    for (const name of ["firstName", "lastName", "middleName"]) {
      await input(name, "José123 😀"); assert.equal(container.querySelector(`[name="${name}"]`).value, "José ");
    }
    await input("firstName", "123😀"); await submit();
    assert.equal(requests.length, 0); assert.match(container.querySelector('[role="alert"]').textContent, /Names must use letters/);
    await input("firstName", "José"); await submit();
    assert.equal(requests.length, 1); assert.equal(requests[0].url, "/api/auth/me"); assert.equal(requests[0].method, "PATCH");
    assert.equal(requests[0].body.firstName, "José"); assert.equal(requests[0].body.address, "Block 2, Manila");
    assert.match(container.textContent, /Profile updated successfully/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});
