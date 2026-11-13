import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { uuid } from "./helpers/catalog-database.mjs";

const { default: Editor } = loadTsModule("components/admin/catalog/CatalogEditorDialog.tsx");
const references = { units: [{ unit_id: uuid(1), name: "Archived villa", is_active: false, archived_at: "2026-10-12T00:00:00Z" }], paymentMethods: [] };
const render = (resource, record) => renderToStaticMarkup(createElement(Editor, { resource, record, references, referencesError: null, busy: false, error: null, onClose: () => {}, onSave: async () => {} }));

test("service editors expose a required per-booking maximum for new and existing services",()=>{
  assert.match(render("services",null),/id="catalog-max_quantity"[^>]*type="number"[^>]*required=""[^>]*min="1"[^>]*max="10000"[^>]*step="1"[^>]*value="1"/);
  assert.match(render("services",{name:"Mattress",price:500,max_quantity:7}),/id="catalog-max_quantity"[^>]*value="7"/);
});

test("editing an archived rate keeps its linked name and uses native date and price fields", () => {
  const markup = render("unit_rates", { unit_rate_id: uuid(2), unit_id: uuid(1), price: 8000.25, effective_from: "2026-10-12", effective_to: null, is_active: false });
  assert.match(markup, /Archived villa \(archived\)/);
  assert.match(markup, /Saving edits keeps it archived/);
  assert.match(markup, /type="date"[^>]*value="2026-10-12"/);
  assert.match(markup, /type="number"[^>]*step="0.01"[^>]*value="8000.25"/);
  assert.match(markup, /Save changes/);
});

test("account editing preserves leading zeros and policy content uses a multiline editor", () => {
  const accountMarkup = render("payment_accounts", { account_id: uuid(3), account_number: "001234", account_name: "Guest payments", is_active: true });
  assert.match(accountMarkup, /id="catalog-account_number"[^>]*type="text"[^>]*value="001234"/);
  const policyMarkup = render("reservation_policies", { title: "Safety", content: "First line\nSecond line", display_order: 0, is_active: true });
  assert.match(policyMarkup, /<textarea[^>]*id="catalog-content"/);
  assert.match(policyMarkup, /First line\nSecond line/);
});

test("QR selection is required for new or incomplete accounts and optional for replacement", () => {
  assert.match(render("payment_accounts", null), /id="catalog-qr"[^>]*required=""/);
  assert.match(render("payment_accounts", { account_id: uuid(3), is_active: true }), /id="catalog-qr"[^>]*required=""/);
  assert.doesNotMatch(render("payment_accounts", { account_id: uuid(3), qr_image: "old/qr.png", is_active: true }), /id="catalog-qr"[^>]*required=""/);
});

test("a bank receiving account allows an account number without a QR image", () => {
  const markup = renderToStaticMarkup(createElement(Editor, { resource: "payment_accounts", record: { ...accountRecord(), payment_method_id: uuid(9) }, references: { units: [], paymentMethods: [{ payment_method_id: uuid(9), name: "Bank transfer", type: "bank", is_active: true }] }, referencesError: null, busy: false, error: null, onClose: () => {}, onSave: async () => {} }));
  assert.doesNotMatch(markup, /id="catalog-qr"[^>]*required=""/);
  assert.match(markup, /Optional when a receiving account number is provided/);
});

function accountRecord() { return { account_id: uuid(3), account_name: "Resort Bank", account_number: "00123456789", is_active: true }; }

test("ocular slot fields limit both clocks to 8 AM through 5 PM", () => {
  const markup = render("ocular_time_slots", null);
  for (const field of ["start_time", "end_time"]) assert.match(markup, new RegExp(`id="catalog-${field}"[^>]*type="time"[^>]*min="08:00"[^>]*max="17:00"`));
  assert.match(markup, /Philippine time/);
});
