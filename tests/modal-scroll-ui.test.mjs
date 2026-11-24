import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, Fragment, StrictMode } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/rooms", pretendToBeVisual: true });
for (const key of ["window", "document", "HTMLElement"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const cache = new Map();
const Catalog = loadTsModule("components/admin/catalog/CatalogDialog.tsx", {}, cache).default;
const Confirmation = loadTsModule("components/ui/ConfirmationDialog.tsx", {}, cache).default;

for (const strict of [false, true]) test(`closing a room form and its confirmation together restores page scrolling${strict ? " in Strict Mode" : ""}`, async () => {
  document.body.style.overflow = "auto";
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const dialogs = createElement(Fragment, null,
    createElement(Catalog, { title: "Room reservation", description: "Room form", busy: false, onClose() {} }, createElement("input")),
    createElement(Confirmation, { isOpen: true, title: "Confirm room reservation", message: "Create this reservation?", onConfirm() {}, onCancel() {} }));
  try {
    await act(async () => root.render(strict ? createElement(StrictMode, null, dialogs) : dialogs));
    assert.equal(document.body.style.overflow, "hidden");
    await act(async () => root.render(null));
    assert.equal(document.body.style.overflow, "auto");
  } finally { await act(async () => root.unmount()); host.remove(); document.body.style.overflow = ""; }
});

test("cancelling confirmation keeps the room form locked until its own dismissal", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const render = (main, confirm) => act(async () => root.render(createElement(Fragment, null,
    main && createElement(Catalog, { title: "Room", description: "Form", busy: false, onClose() {} }),
    createElement(Confirmation, { isOpen: confirm, title: "Confirm", message: "Save?", onConfirm() {}, onCancel() {} }))));
  try {
    await render(true, true); await render(true, false);
    assert.equal(document.body.style.overflow, "hidden");
    await render(false, false); assert.equal(document.body.style.overflow, "");
  } finally { await act(async () => root.unmount()); host.remove(); document.body.style.overflow = ""; }
});
