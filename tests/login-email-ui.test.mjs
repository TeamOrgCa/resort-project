import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

for (const [name, file, emailId, passwordId, endpoint] of [
  ["guest", "app/auth/login/page.tsx", "email", "password", "/api/auth/login"],
  ["staff", "components/admin/auth/AdminLoginForm.tsx", "admin-email", "admin-password", "/api/admin/auth/login"],
]) {
  test(`${name} login removes typed and pasted email spaces and preserves the password`, async () => {
    const originalFetch = globalThis.fetch, posts = [];
    globalThis.fetch = async (url, options) => { posts.push({ url, body: JSON.parse(options.body) }); return Response.json({ success: false, message: "Invalid credentials." }, { status: 401 }); };
    const Component = loadTsModule(file, {
      "next/navigation": { useRouter: () => ({ push() {}, refresh() {} }), useSearchParams: () => new URLSearchParams() },
      "next/image": () => null,
      "next/link": ({ href, children }) => createElement("a", { href }, children),
    }).default;
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    const input = async (id, value) => act(async () => {
      const field = container.querySelector(`#${id}`);
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, value);
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    try {
      await act(async () => root.render(createElement(Component)));
      await input(emailId, "Guest @Example.com");
      assert.equal(container.querySelector(`#${emailId}`).value, "Guest@Example.com");
      await input(emailId, "  Guest\u00a0\u200b @Example.com  ");
      assert.equal(container.querySelector(`#${emailId}`).value, "Guest@Example.com");
      await input(passwordId, " secret with spaces ");
      await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
      assert.deepEqual(posts, [{ url: endpoint, body: { email: "Guest@Example.com", password: " secret with spaces " } }]);
      await input(emailId, "   ");
      await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
      assert.equal(posts.length, 1);
      assert.match(container.querySelector('[role="alert"]').textContent, /valid email address without spaces/);
    } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
  });
}

test("staff OTP refuses email whitespace before contacting authentication", async () => {
  let authCalls = 0;
  const { POST } = loadTsModule("app/api/admin/auth/verify-otp/route.ts", {
    "@/lib/supabase/server": { createClient: async () => { authCalls++; throw new Error("Should not authenticate"); } },
  });
  for (const email of ["staff @gmail.com", " staff@gmail.com", "staff@gmail.com ", "staff\u200b@gmail.com", "   "]) {
    const response = await POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ email, token: "123456" }) }));
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /without spaces/);
  }
  assert.equal(authCalls, 0);
});
