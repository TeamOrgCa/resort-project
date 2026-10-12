import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const guestId = "11111111-1111-4111-8111-111111111111";
const payload = { overall_rating: 5, title: "A lovely stay", review_text: "We enjoyed our stay at the resort and would love to visit again with our family.", would_recommend: true };
const photo = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])], "../../another-guest.svg", { type: "image/png" });
function multipart(file = photo(), details = payload) {
  const form = new FormData(); form.set("review", JSON.stringify(details));
  if (file) form.set("image", file);
  return new Request("http://localhost/api/reviews/create", { method: "POST", body: form });
}
function harness({ authenticated = true, guest = true, duplicate = false, insertError = null, uploadError = null, ownReservation = true, notificationFails = false } = {}) {
  const uploads = [], removals = [], inserts = [];
  let adminCalls = 0;
  const storage = {
    upload: async (path, bytes, options) => { uploads.push({ path, size: bytes.length, options }); return { error: uploadError }; },
    remove: async paths => { removals.push(...paths); return { error: null }; },
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: authenticated ? { id: guestId } : null }, error: null }) },
    from: table => {
      let inserting = false;
      const query = {
        select: () => query, eq: () => query,
        insert: row => { inserting = true; inserts.push(row); return query; },
        single: async () => {
          if (table === "guests") return { data: guest ? { id: guestId, first_name: "Test", last_name: "Guest" } : null, error: null };
          if (table === "reservations") return { data: ownReservation ? { reservation_id: "reservation" } : null, error: null };
          assert.equal(table, "reviews");
          return { data: inserting ? insertError ? null : { review_id: "review", ...inserts.at(-1) } : duplicate ? { review_id: "old" } : null, error: inserting ? insertError : null };
        },
      };
      return query;
    },
  };
  const { POST } = loadTsModule("app/api/reviews/create/route.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/supabase/admin": { createAdminClient: () => { adminCalls++; return { storage: { from: bucket => { assert.equal(bucket, "review-images"); return storage; } } }; } },
    "@/lib/notifications": { createNotifications: async () => {
      if (notificationFails) throw new Error("Notification unavailable");
      return { error: null };
    }, NOTIFICATION_AUDIENCES: { review: [] } },
  });
  return { post: POST, uploads, removals, inserts, adminCalls: () => adminCalls };
}

test("guest photo uploads use generated owned paths, validated content and the review's guest", async () => {
  const h = harness(); const response = await h.post(multipart());
  assert.equal(response.status, 201);
  assert.match(h.uploads[0].path, new RegExp(`^${guestId}/[0-9a-f-]{36}\\.png$`));
  assert.equal(h.uploads[0].options.contentType, "image/png"); assert.equal(h.uploads[0].options.upsert, false);
  assert.equal(h.inserts[0].image_path, h.uploads[0].path); assert.equal(h.inserts[0].guest_id, guestId);
  assert.equal(h.removals.length, 0);
});

test("text-only reviews remain supported and clients cannot attach a forged stored path", async () => {
  for (const json of [false, true]) {
    const h = harness(); const details = { ...payload, image_path: "another-guest/private.png", guest_id: "someone-else" };
    const request = json ? new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(details) }) : multipart(null, details);
    assert.equal((await h.post(request)).status, 201);
    assert.equal(h.inserts[0].image_path, undefined); assert.equal(h.inserts[0].guest_id, guestId);
    assert.equal(h.adminCalls(), 0);
  }
});

test("authentication, guest membership, duplicate reviews and reservation ownership are checked before upload", async () => {
  for (const [options, status] of [[{ authenticated: false }, 401], [{ guest: false }, 403], [{ duplicate: true }, 409], [{ ownReservation: false }, 400]]) {
    const h = harness(options);
    assert.equal((await h.post(multipart(photo(), { ...payload, reservation_id: guestId }))).status, status);
    assert.equal(h.adminCalls(), 0); assert.equal(h.inserts.length, 0);
  }
});

test("oversized, empty, unsupported and forged images are rejected before storage or review writes", async () => {
  const files = [new File([new Uint8Array(3 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }),
    new File([], "empty.png", { type: "image/png" }),
    new File(["<svg/>"], "image.svg", { type: "image/svg+xml" }),
    new File(["<svg onload='alert(1)'/>"], "fake.png", { type: "image/png" })];
  for (const file of files) {
    const h = harness(); assert.equal((await h.post(multipart(file))).status, 400);
    assert.equal(h.adminCalls(), 0); assert.equal(h.inserts.length, 0);
  }
});

test("multiple attachments and invalid review details fail without uploads", async () => {
  const form = new FormData(); form.set("review", JSON.stringify(payload)); form.append("image", photo()); form.append("image", photo());
  const h = harness(); assert.equal((await h.post(new Request("http://localhost", { method: "POST", body: form }))).status, 400);
  for (const details of [{ ...payload, overall_rating: 3.5 }, { ...payload, review_text: "Too short" }, { ...payload, title: "x".repeat(201) }, { ...payload, overall_rating: "5" }]) {
    assert.equal((await h.post(multipart(photo(), details))).status, 400);
  }
  assert.equal(h.adminCalls(), 0);
});

test("failed upload does not save a review and failed review creation removes only the new photo", async () => {
  const failedUpload = harness({ uploadError: { message: "Upload failed" } });
  assert.equal((await failedUpload.post(multipart())).status, 503); assert.equal(failedUpload.inserts.length, 0);
  for (const [code, status] of [["23505", 409], ["PGRST204", 503], ["OTHER", 500]]) {
    const h = harness({ insertError: { code, message: "Save failed" } });
    assert.equal((await h.post(multipart())).status, status);
    assert.deepEqual(h.removals, [h.uploads[0].path]);
  }
});

test("a notification failure does not remove the saved photo or fail a successful review", async () => {
  const h = harness({ notificationFails: true });
  assert.equal((await h.post(multipart())).status, 201); assert.equal(h.removals.length, 0);
});

function feedHarness({ signedError = false } = {}) {
  const approved = { review_id: "visible", is_approved: true, public_display_name: "Guest", overall_rating: 5, title: "Our stay", review_text: "Review", created_at: "2026-10-13T00:00:00Z", image_path: `${guestId}/visible.png` };
  const hidden = { ...approved, review_id: "hidden", is_approved: false, image_path: `${guestId}/hidden.png` };
  const signed = [];
  const query = {
    select: () => query,
    eq: (field, value) => { assert.equal(field, "is_approved"); assert.equal(value, true); return query; },
    order: () => query,
    range: async () => ({ data: [approved, hidden].filter(r => r.is_approved), error: null, count: 1 }),
  };
  const client = { from: () => query, storage: { from: bucket => {
    assert.equal(bucket, "review-images");
    return { createSignedUrls: async (paths, duration) => {
      signed.push({ paths, duration });
      return signedError ? { data: null, error: { message: "Storage unavailable" } }
        : { data: paths.map(path => ({ path, signedUrl: "https://example.com/photo.png?token=test", error: null })), error: null };
    } };
  } } };
  const { GET } = loadTsModule("app/api/reviews/route.ts", { "@/lib/supabase/server": { createClient: async () => client } });
  return { get: () => GET(new Request("http://localhost/api/reviews")), signed, approved };
}

test("public feed signs only approved review photos and does not expose private storage metadata", async () => {
  const h = feedHarness(); const response = await h.get(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(body.reviews.length, 1); assert.equal(body.reviews[0].review_id, "visible");
  assert.match(body.reviews[0].image_url, /^https:\/\//); assert.equal(body.reviews[0].image_path, undefined);
  assert.deepEqual(h.signed, [{ paths: [h.approved.image_path], duration: 3600 }]);
});

test("a photo URL failure preserves readable review text", async () => {
  const h = feedHarness({ signedError: true }); const response = await h.get(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.reviews[0].review_text, "Review"); assert.equal(body.reviews[0].image_url, null);
});
