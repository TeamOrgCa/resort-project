import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest, NextResponse } from "next/server.js";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { containsEmoji, containsEmojiText, removeEmoji } = loadTsModule("lib/validation/emoji.ts");
const { requestHasEmojiText } = loadTsModule("lib/server/text-input-validation.ts");

test("emoji validation catches faces, joined families, flags, modifiers and keycaps without rejecting normal text", () => {
  for (const emoji of ["😀", "❤️", "👨‍👩‍👧‍👦", "🇵🇭", "👍🏽", "1️⃣", "#️⃣", "🏴\u{E0067}\u{E0062}\u{E007F}"]) {
    assert.equal(containsEmoji(`Hello ${emoji}`), true, emoji);
    assert.equal(removeEmoji(`Hello ${emoji}!`), "Hello !", emoji);
  }
  for (const text of ["José Peña", "Maria-Jane O'Neil", "Taytay #12 * 3", "₱1,500.00", "guest+pool@example.com", "日本語", "العربية", "A & B (room 2)"]) {
    assert.equal(containsEmoji(text), false, text); assert.equal(removeEmoji(text), text);
  }
  assert.equal(containsEmojiText({ services: [{ notes: "Pool day 😀" }] }), true);
  assert.equal(containsEmojiText({ count: 2, active: true, notes: null }), false);
});

test("JSON validation reads a clone, catches escaped Unicode and keeps the original body available", async () => {
  for (const type of ["application/json", "text/plain", "application/problem+json"]) {
    const body = '{"guest":{"name":"Guest \\ud83d\\ude00"}}';
    const request = new Request("http://localhost/api/admin/users", { method: "POST", headers: { "content-type": type }, body });
    assert.equal(await requestHasEmojiText(request), true); assert.equal(await request.text(), body);
  }
  const invalid = new Request("http://localhost/api/reviews/create", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(await requestHasEmojiText(invalid), false); assert.equal(await invalid.text(), "{");
});

test("multipart and URL-encoded text fields reject emojis while receipt files remain untouched", async () => {
  const form = new FormData(); form.set("reference", "1234567890123");
  form.set("proof", new File(["binary fixture 😀"], "receipt-😀.png", { type: "image/png" }));
  const valid = new Request("http://localhost/api/admin/refunds", { method: "POST", body: form });
  assert.equal(await requestHasEmojiText(valid), false);
  assert.equal((await valid.formData()).get("proof").name, "receipt-😀.png");
  form.set("reason", "Please refund 😀");
  assert.equal(await requestHasEmojiText(new Request("http://localhost/api/admin/refunds", { method: "POST", body: form })), true);
  assert.equal(await requestHasEmojiText(new Request("http://localhost/api/profile", { method: "POST", body: new URLSearchParams({ name: "Guest 😀" }) })), true);
  assert.equal(await requestHasEmojiText(new Request("http://localhost/api/reviews?q=" + encodeURIComponent("😀"))), true);
});

test("the proxy enforces emoji rejection after authorization and preserves refreshed session cookies", async () => {
  let blocked = false;
  const { proxy } = loadTsModule("proxy.ts", {
    "./lib/supabase/middleware": { updateSession: async () => {
      const response = blocked ? NextResponse.json({ message: "Unauthorized" }, { status: 401 }) : NextResponse.next();
      response.cookies.set("session-fixture", "refreshed"); return response;
    } },
  });
  const make = (path, text) => new NextRequest("http://localhost" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
  for (const path of ["/api/reservations/create", "/api/admin/users", "/api/reviews/create"]) {
    const response = await proxy(make(path, "Guest 😀"));
    assert.equal(response.status, 400); assert.equal((await response.json()).code, "EMOJI_NOT_ALLOWED");
    assert.equal(response.cookies.get("session-fixture").value, "refreshed");
  }
  assert.equal((await proxy(make("/api/admin/users", "José Peña"))).headers.get("x-middleware-next"), "1");
  blocked = true; assert.equal((await proxy(make("/api/admin/users", "Guest 😀"))).status, 401);
});
