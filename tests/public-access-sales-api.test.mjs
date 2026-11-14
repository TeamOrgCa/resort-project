import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const cashier = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const methodId = "33333333-3333-4333-8333-333333333333";
const input = { requestId, guestName: " Maria  Cruz ", contactNumber: "09171234567", accessType: "swimming", paymentFor: " Four swimming admissions ", amount: 800, paymentMethodId: methodId, fundsReceived: true };
const post = body => new Request("http://localhost/api/admin/public-access-sales", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
function harness({ active = true, role = "cashier", permissions = ["transactions", "payment_entry"], method = { name: "Cash", type: "cash" }, file, rpcError, alreadyRecorded = false } = {}) {
  const calls = [], downloads = [];
  const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: method, error: null }) };
  const supabase = { from: () => query, storage: { from: bucket => ({ download: async path => { downloads.push({ bucket, path }); return { data: file, error: null }; } }) }, rpc: async (name, args) => {
    calls.push({ name, args }); return { error: rpcError, data: rpcError ? null : { sale: { sale_id: requestId, receipt_number: "PA-RCPT-TEST" }, alreadyRecorded } };
  } };
  const { POST } = loadTsModule("app/api/admin/public-access-sales/route.ts", {
    "@/lib/server/admin-audit": { requireActiveStaff: async () => active ? { supabase, staffUser: { id: cashier, role } } : null },
    "@/lib/server/role-permissions": { staffHasPermission: async (_client, _role, permission) => permissions.includes(permission) },
  });
  return { POST, calls, downloads };
}

test("public collections require a cashier session and both transaction/payment grants", async () => {
  for (const [options, status] of [[{ active: false }, 401], [{ role: "admin" }, 403], [{ role: "staff" }, 403], [{ permissions: ["transactions"] }, 403], [{ permissions: ["payment_entry"] }, 403]]) {
    const h = harness(options); assert.equal((await h.POST(post(input))).status, status); assert.equal(h.calls.length, 0);
  }
});

test("cash collections normalize contact and notes, use the atomic RPC and expose idempotent receipt results", async () => {
  for (const alreadyRecorded of [false, true]) {
    const h = harness({ alreadyRecorded }); const response = await h.POST(post(input));
    assert.equal(response.status, alreadyRecorded ? 200 : 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json(); assert.equal(result.sale.receipt_number, "PA-RCPT-TEST"); assert.equal(result.alreadyRecorded, alreadyRecorded);
    assert.equal(h.calls[0].name, "record_public_access_sale");
    assert.deepEqual(h.calls[0].args, { p_request: requestId, p_guest: "Maria Cruz", p_contact: "+639171234567", p_type: "swimming", p_payment_for: "Four swimming admissions", p_amount: 800, p_method: methodId, p_reference: null, p_proof: null, p_received: true });
    assert.equal(h.downloads.length, 0);
  }
});

test("invalid public amounts and guest details are rejected before any collection is saved", async () => {
  for (const patch of [{ amount: 0 }, { amount: 1.001 }, { amount: "800" }, { guestName: "Guest123" }, { contactNumber: "123" }, { accessType: "private" }, { paymentFor: "" }, { fundsReceived: false }, { requestId: "bad" }]) {
    const h = harness(); assert.equal((await h.POST(post({ ...input, ...patch }))).status, 400); assert.equal(h.calls.length, 0);
  }
});

test("noncash public collections require an actual reference and owned supported proof, without OCR", async () => {
  const method = { name: "Bank transfer", type: "bank" }, proofPath = `${cashier}/staff/proof.pdf`;
  for (const patch of [{}, { paymentReference: "BANK-123456", proofPath: "other/staff/proof.pdf" }, { paymentReference: "BANK-123456", proofPath: `${cashier}/staff/../proof.pdf` }]) {
    const h = harness({ method }); assert.equal((await h.POST(post({ ...input, ...patch }))).status, 400); assert.equal(h.calls.length, 0);
  }
  const invalid = harness({ method, file: new Blob(["fake"], { type: "application/pdf" }) });
  assert.equal((await invalid.POST(post({ ...input, paymentReference: "BANK-123456", proofPath }))).status, 400); assert.equal(invalid.calls.length, 0);
  const h = harness({ method, file: new Blob(["%PDF-1.4 proof"], { type: "application/pdf" }) });
  assert.equal((await h.POST(post({ ...input, paymentReference: "BANK-123456", proofPath }))).status, 201);
  assert.deepEqual(h.downloads[0], { bucket: "payment-proofs", path: proofPath });
  assert.equal(h.calls[0].args.p_reference, "BANK-123456"); assert.equal(h.calls[0].args.p_proof, proofPath);
});

test("public collection failures distinguish conflict, permission and missing migration without claiming success", async () => {
  for (const [code, status] of [["40001", 409], ["23505", 409], ["42501", 403], ["22023", 400], ["PGRST202", 503]]) {
    const h = harness({ rpcError: { code, message: "Save rejected" } }); const response = await h.POST(post(input));
    assert.equal(response.status, status); assert.equal((await response.json()).success, false);
  }
});
