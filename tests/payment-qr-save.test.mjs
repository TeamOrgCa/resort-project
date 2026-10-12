import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { catalogDatabase, uuid } from "./helpers/catalog-database.mjs";

const account = { account_id: uuid(1), payment_method_id: uuid(2), account_name: "Resort", account_number: "00123", instructions: null, is_active: true };
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "qr.png", { type: "image/png" });
function harness({ existing = null, failUpload = false, failWrite = false } = {}) {
  const database = catalogDatabase({ payment_accounts: existing ? [existing] : [], payment_methods: [{ payment_method_id: uuid(2), is_active: true }] });
  const removed = []; const uploads = []; const audit = [];
  database.storage = { from: () => ({
    upload: async (path) => { uploads.push(path); return { error: failUpload ? { message: "Offline" } : null }; },
    remove: async (paths) => { removed.push(...paths); return { error: null }; },
  }) };
  if (failWrite) database.failNextWrite();
  const route = loadTsModule("app/api/admin/catalog/route.ts", {
    "@/lib/supabase/admin": { createAdminClient: () => database },
    "@/lib/server/admin-audit": { requireAdminStaff: async () => ({ staffUser: { role: "admin" } }), createAuditLog: async (_staff, event) => audit.push(event) },
  });
  const request = (method, payload, file = null) => {
    const form = new FormData(); form.set("payload", JSON.stringify(payload)); if (file) form.set("file", file);
    return route[method](new Request("https://example.com/api/admin/catalog", { method, body: form }));
  };
  return { database, removed, uploads, audit, request };
}
const createPayload = { resource: "payment_accounts", record: { payment_method_id: uuid(2), account_name: "Resort", account_number: "00123" } };

test("payment account creation, editing and restoration require a QR", async () => {
  const created = harness();
  assert.equal((await created.request("POST", createPayload)).status, 400);
  assert.equal(created.database.tables.payment_accounts.length, 0);
  const edited = harness({ existing: { ...account, is_active: false } });
  assert.equal((await edited.request("PATCH", { resource: "payment_accounts", id: uuid(1), record: { account_name: "Changed" } })).status, 400);
  assert.equal((await edited.request("PATCH", { resource: "payment_accounts", id: uuid(1), action: "restore" })).status, 400);
  assert.equal(edited.database.writes.length, 0);
});

test("account is created with its QR in one write, preserving account number zeros", async () => {
  const h = harness();
  const response = await h.request("POST", createPayload, png());
  assert.equal(response.status, 201);
  const record = (await response.json()).record;
  assert.equal(record.account_number, "00123");
  assert.equal(record.qr_image, h.uploads[0]);
  assert.ok(record.qr_image.startsWith(`${record.account_id}/`));
  assert.equal(h.database.writes.length, 1);
});

test("failed QR upload creates no account and leaves replacement details unchanged", async () => {
  const created = harness({ failUpload: true });
  assert.equal((await created.request("POST", createPayload, png())).status, 500);
  assert.equal(created.database.tables.payment_accounts.length, 0);
  assert.equal(created.audit.length, 0);
  const existing = { ...account, qr_image: "old/qr.png" };
  const replacement = harness({ existing, failUpload: true });
  assert.equal((await replacement.request("PATCH", { resource: "payment_accounts", id: uuid(1), record: { account_name: "Changed" } }, png())).status, 500);
  assert.deepEqual(replacement.database.tables.payment_accounts[0], existing);
});

test("failed database save removes the new QR and keeps the previous account", async () => {
  const existing = { ...account, qr_image: "old/qr.png" };
  const h = harness({ existing, failWrite: true });
  assert.equal((await h.request("PATCH", { resource: "payment_accounts", id: uuid(1), record: { account_name: "Changed" } }, png())).status, 500);
  assert.deepEqual(h.removed, h.uploads);
  assert.deepEqual(h.database.tables.payment_accounts[0], existing);
});

test("editing an account with an existing QR retains it without another upload", async () => {
  const h = harness({ existing: { ...account, qr_image: "old/qr.png" } });
  const response = await h.request("PATCH", { resource: "payment_accounts", id: uuid(1), record: { account_name: "Changed" } });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).record.qr_image, "old/qr.png");
  assert.equal(h.uploads.length, 0);
});

test("guest catalog signs private QR images and does not expose unusable storage paths", async () => {
  const signed = [];
  const { GET } = loadTsModule("app/api/catalog/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({}) },
    "@/repositories/catalogRepository": { getActiveCatalog: async () => ({ paymentAccounts: [{ ...account, qr_image: "valid/qr.png" }, { ...account, qr_image: "missing/qr.png" }] }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ storage: { from: () => ({ createSignedUrl: async (path, expiry) => {
      signed.push({ path, expiry });
      return path.startsWith("valid") ? { data: { signedUrl: "https://storage.example/qr?token=signed" }, error: null } : { data: null, error: { message: "Missing" } };
    } }) } }) },
  });
  const response = await GET(); const result = await response.json();
  assert.equal(result.catalog.paymentAccounts[0].qr_image, "https://storage.example/qr?token=signed");
  assert.equal(result.catalog.paymentAccounts[1].qr_image, null);
  assert.equal(signed[0].expiry, 3600);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("guest QR panel renders scan instructions and a signed image link", () => {
  const { default: PaymentQr } = loadTsModule("components/PaymentQr.tsx");
  const markup = renderToStaticMarkup(createElement(PaymentQr, { src: "https://storage.example/qr.png?token=signed", name: "GCash", onRetry: () => {} }));
  assert.match(markup, /Scan to pay with GCash/);
  assert.match(markup, /alt="GCash payment QR code"/);
  assert.match(markup, /Open QR image to save/);
  assert.match(markup, /upload your proof of payment below/);
});
