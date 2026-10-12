import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase, uuid } from "./helpers/catalog-database.mjs";

function harness({ failUpload = false, failAttach = false, missing = false, missingBucket = false } = {}) {
  const database = catalogDatabase({ payment_accounts: missing ? [] : [{ account_id: uuid(1), is_active: true }] });
  const uploads = []; const removed = []; const buckets = [];
  database.storage = { createBucket: async (id, options) => { buckets.push({ id, options }); return { error: null }; }, from: () => ({
    upload: async (path, bytes, options) => {
      uploads.push({ path, bytes, options });
      if (missingBucket && uploads.length === 1) return { error: { message: "Bucket not found" } };
      if (failAttach) database.failNextWrite();
      return { error: failUpload ? { message: "Storage offline" } : null };
    },
    remove: async (paths) => { removed.push(...paths); return { error: null }; },
  }) };
  const { POST } = loadTsModule("app/api/admin/payment-accounts/qr/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => database },
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ supabase: {}, staffUser: { role: "admin" } }), createAuditLog: async () => true },
  });
  const request = (bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), type = "image/png") => {
    const form = new FormData(); form.set("accountId", uuid(1)); form.set("file", new File([bytes], "qr.unsupported-name", { type }));
    return POST(new Request("https://example.com/api/admin/payment-accounts/qr", { method: "POST", body: form }));
  };
  return { request, database, uploads, removed, buckets };
}

test("missing QR bucket is provisioned privately and the upload is retried", async () => {
  const { request, uploads, buckets, database } = harness({ missingBucket: true });
  assert.equal((await request()).status, 200);
  assert.equal(uploads.length, 2);
  assert.equal(buckets[0].id, "payment-qr-codes");
  assert.equal(buckets[0].options.public, false);
  assert.equal(buckets[0].options.fileSizeLimit, 5242880);
  assert.equal(database.tables.payment_accounts[0].qr_image, uploads[1].path);
});

test("QR uploads use the image signature for the extension and update the saved account", async () => {
  const { request, database, uploads } = harness();
  const response = await request();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.path, /\.png$/);
  assert.equal(database.tables.payment_accounts[0].qr_image, body.path);
  assert.equal(uploads.length, 1);
});

test("failed QR upload preserves the account and reports failure", async () => {
  const { request, database } = harness({ failUpload: true });
  assert.equal((await request()).status, 500);
  assert.equal(database.tables.payment_accounts.length, 1);
  assert.equal(database.tables.payment_accounts[0].qr_image, undefined);
});

test("failed QR attachment removes only the newly uploaded asset", async () => {
  const { request, uploads, removed } = harness({ failAttach: true });
  assert.equal((await request()).status, 500);
  assert.deepEqual(removed, [uploads[0].path]);
});

test("missing accounts and images with forged MIME types are rejected before upload", async () => {
  const { request, uploads } = harness({ missing: true });
  assert.equal((await request()).status, 404);
  assert.equal(uploads.length, 0);
  const validAccount = harness();
  assert.equal((await validAccount.request(Buffer.from("<svg onload='alert(1)'/>"))).status, 400);
  assert.equal(validAccount.uploads.length, 0);
});
