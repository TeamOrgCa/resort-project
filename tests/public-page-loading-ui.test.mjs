import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
for (const key of ["window", "document", "HTMLElement", "Node"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const Reveal = loadTsModule("components/ui/PageReveal.tsx").default;
const content = () => createElement(Reveal, null,
  createElement("section", { "data-reveal": true, "data-position": "above" }, "Welcome to the resort"),
  createElement("section", { "data-reveal": true, "data-position": "below" }, createElement("a", { href: "/booking" }, "Book a stay")));

test("public content is present and visible in server HTML and without observer support", async () => {
  const markup = renderToStaticMarkup(content());
  assert.match(markup, /Welcome to the resort/); assert.match(markup, /Book a stay/);
  assert.doesNotMatch(markup, /reveal-state|opacity-0/);
  window.IntersectionObserver = undefined;
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(content()));
    assert.equal(host.querySelector('[data-reveal-state="pending"]'), null);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("sections reveal once on entry, keyboard focus reveals content, and reduced motion removes pending fades", async () => {
  const bounds = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () { return this.dataset.position === "below" ? { top: 1500, bottom: 1700 } : { top: 0, bottom: 200 }; };
  const motion = new window.EventTarget(); motion.matches = false;
  window.matchMedia = () => motion;
  let callback, disconnected = 0;
  const observed = new Set();
  window.IntersectionObserver = class {
    constructor(next) { callback = next; }
    observe(element) { observed.add(element); }
    unobserve(element) { observed.delete(element); }
    disconnect() { disconnected++; observed.clear(); }
  };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(content()));
    const below = host.querySelector('[data-position="below"]');
    assert.equal(host.querySelector('[data-position="above"]').dataset.revealState, "visible");
    assert.equal(below.dataset.revealState, "pending");
    callback([{ target: below, isIntersecting: false }]); assert.equal(below.dataset.revealState, "pending");
    callback([{ target: below, isIntersecting: true }]); assert.equal(below.dataset.revealState, "visible"); assert.equal(observed.has(below), false);
    below.dataset.revealState = "pending";
    below.querySelector("a").focus(); assert.equal(below.dataset.revealState, "visible");
    below.dataset.revealState = "pending";
    motion.matches = true; motion.dispatchEvent(new window.Event("change"));
    assert.equal(host.querySelector("[data-reveal-state]"), null); assert.equal(disconnected, 1);
  } finally { await act(async () => root.unmount()); host.remove(); window.HTMLElement.prototype.getBoundingClientRect = bounds; }
});

test("reduced-motion visitors see content immediately without starting an observer", async () => {
  window.matchMedia = () => ({ matches: true });
  window.IntersectionObserver = class { constructor() { throw Error("Animation observer should not start"); } };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(content()));
    assert.equal(host.querySelector("[data-reveal-state]"), null);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

test("image skeletons settle on load or failure and restart when the image source changes", async () => {
  const { SiteImage } = loadTsModule("components/content/SiteContent.tsx", {
    "next/image": { __esModule: true, default: props => {
      const attributes = { ...props };
      for (const key of ["fill", "unoptimized", "priority"]) delete attributes[key];
      return createElement("img", attributes);
    } },
  });
  const markup = renderToStaticMarkup(createElement(SiteImage, { contentKey: "content.home.about_image", skeleton: true, fill: true, alt: "Resort photo" }));
  assert.match(markup, /alt="Resort photo"/); assert.doesNotMatch(markup, /opacity-0|visibility:\s*hidden/);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let loaded = 0, failed = 0;
  const render = key => act(async () => root.render(createElement(SiteImage, { contentKey: key, skeleton: true, fill: true, alt: "Resort photo", onLoad: () => loaded++, onError: () => failed++ })));
  try {
    await render("content.home.about_image");
    assert.equal(host.firstElementChild.getAttribute("aria-busy"), "true");
    assert.equal(host.firstElementChild.tagName, "IMG", "Loading must not add a layout wrapper around images");
    assert.ok(host.querySelector(".site-image-loading"));
    await act(async () => host.querySelector("img").dispatchEvent(new window.Event("load")));
    assert.equal(loaded, 1); assert.equal(host.querySelector(".site-image-loading"), null);
    await render("content.about.cover_image");
    assert.ok(host.querySelector(".site-image-loading"));
    await act(async () => host.querySelector("img").dispatchEvent(new window.Event("error")));
    assert.equal(failed, 1); assert.equal(host.firstElementChild.getAttribute("aria-busy"), "false");
    assert.equal(host.querySelector(".site-image-loading"), null);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
