import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost", pretendToBeVisual: true });
for (const name of ["window", "document", "HTMLElement", "MutationObserver"]) globalThis[name] = dom.window[name];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client"); after(() => dom.window.close());
const Feedback = loadTsModule("components/InputErrorFeedback.tsx").default;
const PaymentErrorAlert = loadTsModule("components/booking/PaymentErrorAlert.tsx").default;
const { receiptValidationIssues } = loadTsModule("lib/booking/receipt-feedback.ts");
const tick = () => act(async () => { await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))); });
async function mount() {
  const calls = [], c = document.createElement("div"); document.body.append(c); const root = createRoot(c);
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function(options) { calls.push({ element: this, options }); };
  await act(async () => root.render(createElement(Feedback)));
  return { c, calls, close: async () => { await act(async () => root.unmount()); c.remove(); HTMLElement.prototype.scrollIntoView = original; } };
}

test("new and repeated server errors scroll into view and receive accessible focus", async () => {
  const h = await mount();
  try {
    const alert = document.createElement("p"); alert.setAttribute("role", "alert"); alert.textContent = "Payment invalid"; h.c.append(alert);
    await tick(); assert.equal(h.calls[0].element, alert); assert.equal(h.calls[0].options.block, "center"); assert.equal(document.activeElement, alert);
    assert.equal(alert.style.scrollMarginTop, "7rem");
    alert.firstChild.textContent = "Receipt date is invalid"; await tick(); assert.equal(h.calls.length, 2);
  } finally { await h.close(); }
});

test("modal errors scroll their own element, live validation retains input focus and native invalid fields become visible", async () => {
  const h = await mount();
  try {
    const modal = document.createElement("div"); modal.setAttribute("role", "dialog"); h.c.append(modal);
    const input = document.createElement("input"); modal.append(input); input.focus();
    const alert = document.createElement("p"); alert.setAttribute("role", "alert"); alert.textContent = "Maximum 30 guests"; modal.append(alert);
    await tick(); assert.equal(h.calls[0].element, alert); assert.equal(document.activeElement, input);
    input.dispatchEvent(new window.Event("invalid", { cancelable: true })); await tick(); assert.equal(h.calls.at(-1).element, input);
    assert.equal(document.activeElement, input);
  } finally { await h.close(); }
});

test("fixed notices and hidden alerts do not unexpectedly scroll the page", async () => {
  const h = await mount();
  try {
    h.c.innerHTML = '<div data-no-auto-scroll><p role="alert">Emoji blocked</p></div><div hidden><p role="alert">Hidden error</p></div>';
    await tick(); assert.equal(h.calls.length, 0);
  } finally { await h.close(); }
});

test("GCash issues render as individual bullets without splitting decimal amounts", () => {
  const issues = receiptValidationIssues("receipt amount is below PHP 100.00; reference number differs; receipt date is invalid. Upload the original screenshot.");
  assert.deepEqual(issues, ["Receipt amount is below PHP 100.00", "Reference number differs", "Receipt date is invalid.", "Upload the original screenshot."]);
  const doc = new JSDOM(renderToStaticMarkup(createElement(PaymentErrorAlert, { message: "Long receipt failure", issues }))).window.document;
  assert.equal(doc.querySelectorAll('[role="alert"] li').length, 4); assert.match(doc.querySelector("li").textContent, /100.00/);
  assert.match(doc.body.textContent, /Payment could not be submitted/); assert.equal(doc.body.textContent.includes("Long receipt failure"), false);
});
