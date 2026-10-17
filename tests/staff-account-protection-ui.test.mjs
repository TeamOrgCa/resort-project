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
    assert.equal(writes[0].isActive, false); assert.equal(writes[0].role, "staff");
  } finally { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; }
});
