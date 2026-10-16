import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/admin/configuration" });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());

test("content sections retain every saved key exactly once, including additional future fields", () => {
  const { contentDefinitions } = loadTsModule("lib/settings/content-catalog.ts");
  const { contentSections } = loadTsModule("lib/settings/content-layout.ts");
  for (const group of ["Branding", "Home page", "About page"]) {
    const definitions = contentDefinitions.filter(definition => definition.group === group);
    const keys = contentSections(group, definitions).flatMap(section => section.definitions.map(definition => definition.key));
    assert.deepEqual([...keys].sort(), definitions.map(definition => definition.key).sort());
    assert.equal(new Set(keys).size, keys.length);
    const added = { ...definitions[0], key: "content.future.field" };
    assert.equal(contentSections(group, [...definitions, added]).flatMap(section => section.definitions).filter(item => item.key === added.key).length, 1);
  }
});

test("page and section navigation preserve drafts, failed saves retain edits and saving publishes only the selected page", async () => {
  const saves = []; let settings = {}, fail = true;
  const Component = loadTsModule("components/admin/ConfigurationClient.tsx", {
    "next/image": ({ src, alt }) => createElement("img", { src, alt }),
    "@/components/admin/PolicyEditor": { default: () => null },
    "@/components/settings/SettingsProvider": { useSettings: () => ({ settings, isLoading: false, isRefreshing: false, error: null, save: async updates => {
      if (fail) { fail = false; throw new Error("Could not save content. Retry."); }
      saves.push(updates); settings = { ...settings, ...Object.fromEntries(updates.map(update => [update.key, update.value])) };
    } }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const button = label => [...container.querySelectorAll("button")].find(node => node.textContent.trim() === label);
  const click = async label => act(async () => { const target = button(label); assert.ok(target, label); assert.equal(target.disabled, false); target.click(); });
  const field = label => document.getElementById([...container.querySelectorAll("label[for]")].find(node => node.textContent === label)?.htmlFor);
  const edit = async (label, value) => act(async () => {
    const input = field(label); assert.ok(input, label);
    Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(Component)));
    await click("Website content"); await edit("Footer tagline", "A saved branding draft");
    await click("Home page"); await edit("Hero heading", "A new welcome");
    await click("Amenities"); await edit("Amenities heading", "Explore our amenities");
    await click("About page"); await click("Rates & inclusions"); await edit("Rates section heading", "About page draft");
    await click("Home page"); assert.equal(field("Hero heading").value, "A new welcome");
    await click("Save home page"); assert.match(container.querySelector('[role="alert"]').textContent, /Retry/);
    assert.equal(field("Hero heading").value, "A new welcome");
    await click("Save home page");
    assert.equal(saves.length, 1); assert.ok(saves[0].every(update => update.key.startsWith("content.home.")));
    assert.equal(saves[0].find(update => update.key === "content.home.hero_title").value, "A new welcome");
    assert.equal(saves[0].find(update => update.key === "content.home.world_class_amenities").value, "Explore our amenities");
    await click("Branding"); assert.equal(field("Footer tagline").value, "A saved branding draft");
    await click("About page"); await click("Rates & inclusions"); assert.equal(field("Rates section heading").value, "About page draft");
    assert.equal(container.querySelector('a[target="_blank"]').getAttribute("href"), "/about");
  } finally { await act(async () => root.unmount()); container.remove(); }
});

test("website defaults require confirmation, preserve drafts on failure, and publish every content group on success", async () => {
  const { contentDefinitions } = loadTsModule("lib/settings/content-catalog.ts");
  let settings = { "content.branding.tagline": "Tester text", "content.home.hero_title": "Tester title", "resort.name": "Resort name" };
  let attempts = 0, release;
  const Component = loadTsModule("components/admin/ConfigurationClient.tsx", {
    "next/image": ({ src, alt }) => createElement("img", { src, alt }),
    "@/components/admin/PolicyEditor": { default: () => null },
    "@/components/settings/SettingsProvider": { useSettings: () => ({ settings, isLoading: false, isRefreshing: false, error: null,
      save: async () => {}, restoreContentDefaults: async () => {
        attempts++; if (attempts === 1) throw Error("Restore failed. Retry.");
        await new Promise(resolve => { release = resolve; });
        settings = { ...settings, ...Object.fromEntries(contentDefinitions.map(definition => [definition.key, definition.defaultValue])) };
      } }) },
  }).default;
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  const button = label => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === label);
  const click = async label => act(async () => { assert.ok(button(label), label); assert.equal(button(label).disabled, false); button(label).click(); });
  const field = label => document.getElementById([...container.querySelectorAll("label[for]")].find(node => node.textContent === label)?.htmlFor);
  const edit = async (label, value) => act(async () => {
    const input = field(label); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(createElement(Component)));
    await edit("Resort name", "Keep unsaved resort name"); await click("Website content"); await edit("Footer tagline", "Unsaved tester text");
    await click("Restore website defaults"); assert.equal(attempts, 0); assert.ok(document.querySelector('[role="dialog"]'));
    await click("Keep current content"); assert.equal(field("Footer tagline").value, "Unsaved tester text");
    await click("Restore website defaults"); await click("Restore and publish defaults");
    assert.match(document.querySelector('[role="dialog"] [role="alert"]').textContent, /Restore failed/);
    assert.equal(field("Footer tagline").value, "Unsaved tester text");
    await click("Restore and publish defaults"); assert.equal(button("Restoring...").disabled, true);
    assert.equal(button("Keep current content").disabled, true); assert.equal(button("Saving...").disabled, true);
    await act(async () => release()); assert.equal(attempts, 2); assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(field("Footer tagline").value, contentDefinitions.find(definition => definition.key === "content.branding.tagline").defaultValue);
    assert.match(container.textContent, /restored and published/);
    await click("Home page"); assert.equal(field("Hero heading").value, contentDefinitions.find(definition => definition.key === "content.home.hero_title").defaultValue);
    await click("Resort information"); assert.equal(field("Resort name").value, "Keep unsaved resort name");
  } finally { await act(async () => root.unmount()); container.remove(); }
});
