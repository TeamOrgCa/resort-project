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
    if (options?.method) writes.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    return Response.json({ success: true, rows: [staff], currentStaffUserId: "self", temporaryPassword: "Generated#Password234" });
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
    await value(form.querySelector('input[aria-label="Email username"]'), "new");
    assert.equal(form.querySelector('input[type="password"]'), null);
    await submit(); assert.equal(writes.length, 0);
    assert.match(document.querySelector('[role="alertdialog"]').textContent, /new@marvilleresort.com/);
    assert.doesNotMatch(document.querySelector('[role="alertdialog"]').textContent, /temporary123/);
    await act(async () => document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.ok(document.querySelector('[role="dialog"]')); assert.equal(form.querySelector('input[aria-label="Email username"]').value, "new");
    await submit(); await confirm("Confirm create account"); assert.equal(writes.length, 1); assert.equal(writes[0].method, "POST");
    assert.match(document.querySelector('[role="dialog"]').textContent, /Generated#Password234/);
    assert.equal(Object.hasOwn(writes[0].body, "password"), false);
    await click(button(document.body, "Done"));
    assert.doesNotMatch(container.textContent, /Generated#Password234/);
    await click(button(container, "Edit"));
    form = document.querySelector('[role="dialog"] form');
    await value(form.querySelector('input:not([type="checkbox"])'), "Updated Manager");
    await submit(); assert.equal(writes.length, 1); await confirm("Confirm account changes");
    assert.equal(writes.length, 2); assert.equal(writes[1].body.fullName, "Updated Manager");
    await click(button(container, "Reset Password"));
    assert.equal(document.querySelector('[role="dialog"] input[type="password"]'), null);
    await submit(); assert.equal(writes.length, 2);
    assert.doesNotMatch(document.querySelector('[role="alertdialog"]').textContent, /newtemporary123/);
    await confirm("Confirm password reset"); assert.equal(writes.length, 3); assert.match(writes[2].url, /password$/);
    assert.equal(writes[2].body, null);
    assert.match(document.querySelector('[role="dialog"]').textContent, /Generated#Password234/);
    await click(button(document.body, "Done"));
    assert.doesNotMatch(container.textContent, /Generated#Password234/);
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

test("role editor prevents non-Gmail staff promotion even if a disabled Admin option is forced", async () => {
  for (const role of ["staff", "cashier"]) {
    const h = await editDialog({ ...profile, role, email: "staff@marvilleresort.com" });
    try {
      const select = h.container.querySelector("select");
      assert.equal(select.querySelector('option[value="admin"]').disabled, true);
      assert.match(h.container.textContent, /Admin access requires a @gmail.com/);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "admin");
        select.dispatchEvent(new window.Event("change", { bubbles: true }));
      });
      await h.submit(); assert.deepEqual(h.submissions, []);
      assert.match(h.container.querySelector('[role="alert"]').textContent, /Only accounts using @gmail.com/);
    } finally { await h.close(); }
  }
  const gmail = await editDialog({ ...profile, role: "staff", email: "owner@gmail.com" });
  try {
    const select = gmail.container.querySelector("select");
    assert.equal(select.querySelector('option[value="admin"]').disabled, false);
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set.call(select, "admin");
      select.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await gmail.submit(); assert.equal(gmail.submissions[0].role, "admin");
  } finally { await gmail.close(); }
});

test("reset generates a password without a password input", async () => {
  const Component = loadTsModule("components/admin/users/ResetPasswordDialog.tsx").default, submissions = [];
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Component, { isOpen: true, isSubmitting: false, error: "", staffEmail: "cashier@marvilleresort.com", onClose() {}, onSubmit: (...args) => submissions.push(args) })));
    assert.equal(container.querySelector("input"), null);
    assert.match(container.textContent, /generated automatically/);
    await act(async () => container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.deepEqual(submissions, [[]]);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("edit dialog allows the current admin to update their own name with validation", async () => {
  for (const id of ["self"]) {
    const h = await editDialog({ ...profile, id });
    try {
      assert.equal(h.container.querySelector("select").disabled, true);
      const active = h.container.querySelector('input[type="checkbox"]');
      assert.equal(active.disabled, true); assert.equal(active.checked, true);
      assert.match(h.container.textContent, /Admin accounts cannot be disabled/);
      const name = h.container.querySelector('input:not([type="checkbox"])');
      assert.equal(name.disabled, false);
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

test("peer admin names stay read-only even if dialog input and submit events are forced", async () => {
  for (const is_active of [true, false]) {
    const h = await editDialog({ ...profile, is_active });
    try {
      const name = h.container.querySelector('input:not([type="checkbox"])');
      assert.equal(name.disabled, true);
      assert.match(h.container.textContent, /Only the account owner can change this admin's name/);
      const save = [...h.container.querySelectorAll("button")].find(button => button.textContent === "Save Changes");
      assert.equal(save.disabled, is_active);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(name, "Forged Name");
        name.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await h.submit();
      assert.equal(h.submissions[0].fullName, profile.full_name);
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
    if (options?.method === "PATCH") writes.push(options.body ? JSON.parse(options.body) : null);
    return Response.json({ success: true, rows, currentStaffUserId: "self" });
  };
  const noop = () => null;
  const Component = loadTsModule("app/admin/(portal)/users/page.tsx", {
    "@/components/admin/AdminTablePreview": props => createElement("div", null, props.rows.map(row => createElement("div", { key: row.id },
      createElement("button", { "data-id": row.id, disabled: props.isRowActionDisabled("Toggle Status", row), onClick: () => props.onRowAction("Toggle Status", row) }, props.getRowActionLabel("Toggle Status", row)),
      createElement("button", { "data-id": `${row.id}-reset`, disabled: props.isRowActionDisabled("Reset Password", row), onClick: () => props.onRowAction("Reset Password", row) }, "Reset Password"),
      createElement("button", { "data-id": `${row.id}-force-reset`, onClick: () => props.onRowAction("Reset Password", row) }, "Direct action"),
      createElement("button", { "data-id": `${row.id}-edit`, disabled: props.isRowActionDisabled("Edit", row), onClick: () => props.onRowAction("Edit", row) }, "Edit"),
      createElement("button", { "data-id": `${row.id}-force-edit`, onClick: () => props.onRowAction("Edit", row) }, "Direct edit"),
    ))),
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
    for (const id of ["peer", "inactive"]) {
      assert.equal(container.querySelector(`[data-id="${id}-edit"]`).disabled, true);
      await act(async () => container.querySelector(`[data-id="${id}-force-edit"]`).click());
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.match(container.querySelector('[role="alert"]').textContent, /Only the account owner can change an admin's name/);
    }
    for (const id of ["self", "manager", "cashier"]) assert.equal(container.querySelector(`[data-id="${id}-edit"]`).disabled, false);
    for (const id of ["peer", "self", "inactive"]) {
      assert.equal(container.querySelector(`[data-id="${id}-reset"]`).disabled, true);
      await act(async () => container.querySelector(`[data-id="${id}-force-reset"]`).click());
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.match(container.querySelector('[role="alert"]').textContent, /Admin passwords cannot be reset/);
    }
    for (const id of ["manager", "cashier"]) assert.equal(container.querySelector(`[data-id="${id}-reset"]`).disabled, false);
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
