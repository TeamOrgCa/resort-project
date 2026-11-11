import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/users" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const profile = { id: "peer", full_name: "Other Admin", email: "other@example.com", role: "admin", is_active: true };

test("staff creation, edits and password resets require confirmation and cancellation preserves form values", async () => {
  const originalFetch = globalThis.fetch, writes = [];
  const staff = { ...profile, id: "manager", full_name: "Test Manager", role: "staff" };
  globalThis.fetch = async (url, options) => {
    if (options?.method) writes.push({ url, method: options.method, body: JSON.parse(options.body) });
    return Response.json({ success: true, rows: [staff], currentStaffUserId: "self" });
  };
  const Component = loadTsModule("app/admin/(portal)/users/page.tsx", {
    "@/components/admin/AdminTablePreview": props => createElement("div", null,
      createElement("button", { onClick: () => props.onAction("Add Staff User") }, "Add account"),
      props.rows.map(row => createElement("div", { key: row.id }, ["Edit", "Reset Password"].map(action => createElement("button", { key: action, onClick: () => props.onRowAction(action, row) }, action))))),
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const button = (root, label) => [...root.querySelectorAll("button")].find(button => button.textContent.trim() === label);
  const click = element => act(async () => { assert.ok(element); element.click(); });
  const value = (element, next) => act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(element, next);
    element.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  const submit = () => act(async () => document.querySelector('[role="dialog"] form').dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
  const confirm = label => click(button(document.querySelector('[role="alertdialog"]'), label));
  try {
    await act(async () => root.render(createElement(Component)));
    await click(button(container, "Add account"));
    let form = document.querySelector('[role="dialog"] form');
    await value(form.querySelector('input[placeholder="Alex Mendoza"]'), "New Manager");
    await value(form.querySelector('input[type="email"]'), "new@example.com");
    await value(form.querySelector('input[type="password"]'), "temporary123");
    await submit(); assert.equal(writes.length, 0);
    assert.doesNotMatch(document.querySelector('[role="alertdialog"]').textContent, /temporary123/);
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.ok(document.querySelector('[role="dialog"]')); assert.equal(form.querySelector('input[type="email"]').value, "new@example.com");
    await submit(); await confirm("Confirm create account"); assert.equal(writes.length, 1); assert.equal(writes[0].method, "POST");
    await click(button(container, "Edit"));
    form = document.querySelector('[role="dialog"] form');
    await value(form.querySelector('input:not([type="checkbox"])'), "Updated Manager");
    await submit(); assert.equal(writes.length, 1); await confirm("Confirm account changes");
    assert.equal(writes.length, 2); assert.equal(writes[1].body.fullName, "Updated Manager");
    await click(button(container, "Reset Password"));
    await value(document.querySelector('[role="dialog"] input[type="password"]'), "newtemporary123");
    await submit(); assert.equal(writes.length, 2);
    assert.doesNotMatch(document.querySelector('[role="alertdialog"]').textContent, /newtemporary123/);
    await confirm("Confirm password reset"); assert.equal(writes.length, 3); assert.match(writes[2].url, /password$/);
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});

async function editDialog(staffUser) {
  const submissions = [];
  const Component = loadTsModule("components/admin/users/EditStaffDialog.tsx").default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => root.render(createElement(Component, { isOpen: true, isSubmitting: false, error: "", staffUser,
    currentStaffUserId: "self", onClose() {}, onSubmit: values => submissions.push(values) })));
  return { container, submissions,
    submit: () => act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))),
    close: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test("edit dialog protects both peer and current admins while allowing profile edits", async () => {
  for (const id of ["peer", "self"]) {
    const h = await editDialog({ ...profile, id });
    try {
      assert.equal(h.container.querySelector("select").disabled, true);
      const active = h.container.querySelector('input[type="checkbox"]');
      assert.equal(active.disabled, true); assert.equal(active.checked, true);
      assert.match(h.container.textContent, /Admin accounts cannot be disabled/);
      const name = h.container.querySelector('input:not([type="checkbox"])');
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(name, "Updated Admin");
        name.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await h.submit();
      assert.deepEqual(h.submissions, [{ fullName: "Updated Admin", role: "admin", isActive: true }]);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(name, "123😀");
        name.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      assert.equal(name.value, ""); await h.submit();
      assert.equal(h.submissions.length, 1); assert.match(h.container.querySelector('[role="alert"]').textContent, /Names must use letters/);
    } finally { await h.close(); }
  }
});

test("edit dialog allows staff status changes and reactivation of an inactive admin", async () => {
  for (const staffUser of [{ ...profile, role: "staff" }, { ...profile, role: "cashier" }, { ...profile, is_active: false }]) {
    const h = await editDialog(staffUser);
    try {
      const active = h.container.querySelector('input[type="checkbox"]');
      assert.equal(active.disabled, false);
      assert.equal(h.container.querySelector("select").disabled, staffUser.role === "admin");
      await act(async () => active.click()); await h.submit();
      assert.equal(h.submissions[0].isActive, !staffUser.is_active);
    } finally { await h.close(); }
  }
});

test("staff table disables active admin status actions and keeps other statuses manageable", async () => {
  const originalFetch = globalThis.fetch, writes = [];
  const rows = [profile, { ...profile, id: "self" }, { ...profile, id: "inactive", is_active: false }, { ...profile, id: "manager", role: "staff" }, { ...profile, id: "cashier", role: "cashier" }];
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "PATCH") writes.push(JSON.parse(options.body));
    return Response.json({ success: true, rows, currentStaffUserId: "self" });
  };
  const noop = () => null;
  const Component = loadTsModule("app/admin/(portal)/users/page.tsx", {
    "@/components/admin/AdminTablePreview": props => createElement("div", null, props.rows.map(row => createElement("button", {
      key: row.id, "data-id": row.id, disabled: props.isRowActionDisabled("Toggle Status", row),
      onClick: () => props.onRowAction("Toggle Status", row),
    }, props.getRowActionLabel("Toggle Status", row)))),
    "@/components/admin/users/CreateStaffDialog": noop,
    "@/components/admin/users/EditStaffDialog": noop,
    "@/components/admin/users/ResetPasswordDialog": noop,
    "@/components/admin/users/RolePermissionsEditor": noop,
    "@/components/admin/users/GuestAccountsPanel": noop,
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component)));
    for (const id of ["peer", "self"]) {
      const button = container.querySelector(`[data-id="${id}"]`); assert.equal(button.disabled, true);
      await act(async () => button.click());
    }
    assert.equal(writes.length, 0);
    for (const id of ["inactive", "manager", "cashier"]) assert.equal(container.querySelector(`[data-id="${id}"]`).disabled, false);
    await act(async () => container.querySelector('[data-id="manager"]').click());
    assert.equal(writes.length, 0);
    const dialog = document.querySelector('[role="alertdialog"]');
    assert.match(dialog.textContent, /staff portal/);
    await act(async () => [...dialog.querySelectorAll("button")].find(button => button.textContent === "Confirm deactivation").click());
    assert.equal(writes[0].isActive, false); assert.equal(writes[0].role, "staff");
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});
