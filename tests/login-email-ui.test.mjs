import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, Fragment } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const LoginSuccessToast = loadTsModule("components/ui/LoginSuccessToast.tsx").default;
const withToast = Component => createElement(Fragment, null, createElement(LoginSuccessToast), createElement(Component));

test("guest login shows remaining attempts and prevents submissions during the one-minute countdown", async () => {
  const originalFetch = globalThis.fetch, originalNow = Date.now, originalInterval = window.setInterval, originalClear = window.clearInterval;
  let calls = 0, now = originalNow(), tick;
  Date.now = () => now;
  window.setInterval = callback => { tick = callback; return 1; }; window.clearInterval = () => {};
  globalThis.fetch = async () => { calls++; return Response.json({ success:false,message: calls < 4 ? "Invalid credentials." : "Too many attempts. Try again in one minute.",attemptsRemaining:Math.max(4-calls,0),retryAfterSeconds:calls >= 4 ? 60 : 0 },{status:calls >= 4 ? 429 : 401}); };
  const Component = loadTsModule("app/auth/login/page.tsx", {
    "next/navigation":{useRouter:()=>({push(){},refresh(){}}),useSearchParams:()=>new URLSearchParams()},
    "next/image":()=>null,"next/link":({href,children})=>createElement("a",{href},children),
  }).default;
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  const submit=()=>act(async()=>container.querySelector("form").dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true})));
  try {
    await act(async()=>root.render(createElement(Component)));
    for(const [id,value] of [["email","guest@example.com"],["password","wrong-password"]]) await act(async()=>{
      const input=container.querySelector(`#${id}`);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set.call(input,value);input.dispatchEvent(new window.Event("input",{bubbles:true}));
    });
    for(const remaining of [3,2,1]) {await submit();assert.match(container.querySelector("#login-attempt-status").textContent,new RegExp(`${remaining} login attempt`));}
    await submit(); assert.equal(container.querySelector('button[type="submit"]').disabled,true);
    assert.match(container.querySelector("#login-attempt-status").textContent,/60 seconds/);
    await submit(); assert.equal(calls,4);
    now+=59000;await act(async()=>tick());assert.match(container.querySelector("#login-attempt-status").textContent,/1 second\./);
    now+=1000;await act(async()=>tick());assert.equal(container.querySelector('button[type="submit"]').disabled,false);
    assert.match(container.querySelector("#login-attempt-status").textContent,/4 login attempts/);
    assert.equal(container.querySelector('[role="alert"]'),null);
  } finally {
    await act(async()=>root.unmount());container.remove();globalThis.fetch=originalFetch;Date.now=originalNow;window.setInterval=originalInterval;window.clearInterval=originalClear;
  }
});

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
      await act(async () => root.render(withToast(Component)));
      await input(emailId, "Guest @Example.com");
      assert.equal(container.querySelector(`#${emailId}`).value, "Guest@Example.com");
      await input(emailId, "  Guest\u00a0\u200b @Example.com  ");
      assert.equal(container.querySelector(`#${emailId}`).value, "Guest@Example.com");
      await input(passwordId, " secret with spaces ");
      await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
      assert.deepEqual(posts, [{ url: endpoint, body: { email: "Guest@Example.com", password: " secret with spaces " } }]);
      assert.equal(document.querySelector('[role="alertdialog"]'), null, "failed logins must not show a welcome popup");
      assert.equal(document.querySelector('[role="status"]'), null, "failed logins must not show a welcome toast");
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

test("staff and admin welcome toasts appear only after complete authentication and redirect automatically", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [role, useOtp, mustChangePassword, fullName, expectedName, destination] of [
      ["admin", false, false, "Alex Admin", "Alex Admin", "/admin/users"],
      ["staff", true, false, "Maria Manager", "Maria Manager", "/admin"],
      ["cashier", false, true, "", "cashier", "/staff/change-password"],
    ]) {
      const pushes = [], posts = []; let refreshes = 0;
      globalThis.fetch = async (url, options) => {
        posts.push({ url, body: JSON.parse(options.body) });
        if (useOtp && url.endsWith("/login")) return Response.json({ success: true, requiresOtp: true });
        return Response.json({ success: true, staffUser: { role, fullName, mustChangePassword } });
      };
      const Component = loadTsModule("components/admin/auth/AdminLoginForm.tsx", {
        "next/navigation": { useRouter: () => ({ push: path => pushes.push(path), refresh: () => refreshes++ }), useSearchParams: () => new URLSearchParams() },
        "next/link": ({ href, children }) => createElement("a", { href }, children),
      }).default;
      const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
      const input = async (id, value) => act(async () => {
        const field = container.querySelector(`#${id}`);
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, value);
        field.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      const submit = () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
      try {
        await act(async () => root.render(withToast(Component)));
        await input("admin-email", `${role}@example.com`); await input("admin-password", "secret123");
        await submit();
        if (useOtp) {
          assert.equal(document.querySelector('[role="alertdialog"]'), null); assert.deepEqual(pushes, []);
          assert.equal(document.querySelector('[role="status"]'), null);
          await input("admin-otp", "123456"); await submit(); assert.equal(posts[1].url, "/api/admin/auth/verify-otp");
        }
        const toast = document.querySelector('[role="status"]'); assert.ok(toast);
        assert.match(toast.textContent, new RegExp(`Welcome, ${expectedName}!`));
        assert.ok(toast.querySelector(".bg-green-50"));
        assert.equal(document.querySelector('[role="alertdialog"]'), null);
        assert.equal(document.body.style.overflow, "");
        assert.equal(container.querySelector('button[type="submit"]').disabled, true);
        await submit(); assert.equal(posts.length, useOtp ? 2 : 1);
        assert.deepEqual(pushes, [destination]); assert.equal(refreshes, 1);
      } finally { await act(async () => root.unmount()); container.remove(); }
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("welcome toasts clear when logout starts or another tab changes account", async () => {
  const { showLoginSuccessToast } = loadTsModule("components/ui/LoginSuccessToast.tsx");
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(LoginSuccessToast)));
    await act(async () => showLoginSuccessToast("Welcome, Alex!"));
    assert.match(container.textContent, /Welcome, Alex/);
    await act(async () => window.dispatchEvent(new window.CustomEvent("marville:session-change", { detail: "changing" })));
    assert.equal(container.querySelector('[role="status"]'), null);
    await act(async () => showLoginSuccessToast("Welcome, Jamie!"));
    await act(async () => window.dispatchEvent(new window.StorageEvent("storage", { key: "marville:session-changed" })));
    assert.equal(container.querySelector('[role="status"]'), null);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("the login toast dismisses automatically after five seconds without blocking the page", async () => {
  const originalTimer = window.setTimeout, originalClear = window.clearTimeout;
  let expire, delay;
  window.setTimeout = (callback, milliseconds) => { expire = callback; delay = milliseconds; return 1; };
  window.clearTimeout = () => {};
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const { showLoginSuccessToast } = loadTsModule("components/ui/LoginSuccessToast.tsx");
  try {
    await act(async () => root.render(createElement(LoginSuccessToast)));
    await act(async () => showLoginSuccessToast("Welcome, Alex!"));
    assert.equal(delay, 5000); assert.ok(container.querySelector('[role="status"]'));
    assert.equal(document.body.style.overflow, "");
    await act(async () => expire()); assert.equal(container.querySelector('[role="status"]'), null);
  } finally {
    await act(async () => root.unmount()); container.remove(); window.setTimeout = originalTimer; window.clearTimeout = originalClear;
  }
});

test("successful guest login shows a top toast that survives navigation and redirects to a safe destination", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const [redirect, firstName, expectedName, destination] of [
      ["/booking/form", "Maria", "Maria", "/booking/form"],
      ["https://example.com", undefined, "guest", "/"],
    ]) {
      const pushes = [], posts = []; let refreshes = 0, resolveLogin;
      globalThis.fetch = (url, options) => {
        posts.push({ url, body: JSON.parse(options.body) });
        return new Promise(resolve => { resolveLogin = resolve; });
      };
      const router = { push: path => pushes.push(path), refresh: () => refreshes++ };
      const Component = loadTsModule("app/auth/login/page.tsx", {
        "next/navigation": { useRouter: () => router, useSearchParams: () => new URLSearchParams({ redirect }) },
        "next/image": () => null,
        "next/link": ({ href, children }) => createElement("a", { href }, children),
      }).default;
      const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
      const submit = () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
      try {
        await act(async () => root.render(withToast(Component)));
        for (const [id, value] of [["email", "guest@example.com"], ["password", "secret123"]]) {
          await act(async () => {
            const field = container.querySelector(`#${id}`);
            Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, value);
            field.dispatchEvent(new window.Event("input", { bubbles: true }));
          });
        }
        await submit();
        assert.equal(document.querySelector('[role="alertdialog"]'), null);
        assert.equal(container.querySelector('button[type="submit"]').disabled, true);
        await submit(); assert.equal(posts.length, 1);
        await act(async () => resolveLogin(Response.json({ success: true, firstName })));
        const toast = document.querySelector('[role="status"]');
        assert.ok(toast); assert.match(toast.textContent, new RegExp(`Welcome back, ${expectedName}!`));
        assert.equal(document.querySelector('[role="alertdialog"]'), null);
        assert.equal(document.body.style.overflow, "");
        assert.notEqual(document.activeElement, toast.querySelector("button"));
        assert.ok(toast.parentElement.classList.contains("top-4"));
        await submit(); assert.equal(posts.length, 1);
        assert.deepEqual(pushes, [destination]); assert.equal(refreshes, 1);
        await act(async () => root.render(createElement(Fragment, null, createElement(LoginSuccessToast), createElement("main", null, "Destination page"))));
        assert.match(document.querySelector('[role="status"]').textContent, new RegExp(expectedName));
        await act(async () => document.querySelector('[aria-label="Dismiss login notification"]').click());
        assert.equal(document.querySelector('[role="status"]'), null);
      } finally { await act(async () => root.unmount()); container.remove(); }
      assert.equal(document.body.style.overflow, "");
    }
  } finally { globalThis.fetch = originalFetch; }
});
