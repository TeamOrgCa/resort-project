import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
for (const key of ["window", "document", "HTMLElement"]) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const imageMock = ({ src, alt, onError }) => createElement("img", { src, alt, onError });
const mocks = { "next/image": imageMock };
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
async function mount(Component, props) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Component, props)));
  return { container, root, close: async () => { await act(async () => root.unmount()); container.remove(); } };
}

test("real service images retain an explicit display area without generated sizing utilities", async () => {
  const Card = loadTsModule("components/booking/ServiceSelectionCard.tsx").default;
  const ui = await mount(Card, { service: { id: "1", name: "Mattress", description: "Fresh linen", price: 500, imageUrl: "https://images.example.com/mattress.jpg" }, selected: false, onToggle: () => {} });
  try {
    const preview = ui.container.querySelector('[aria-label="View Mattress photo"]');
    const image = preview.querySelector("img");
    assert.match(preview.style.height, /clamp\(/);
    assert.equal(preview.style.width, "100%");
    assert.equal(image.getAttribute("src"), "https://images.example.com/mattress.jpg");
    assert.notEqual(image.style.position, "absolute", "the photo must contribute to normal image layout");
    assert.equal(image.style.display, "block");
    assert.equal(image.style.width, "100%");
    assert.equal(image.style.height, "100%");
    assert.equal(image.style.objectFit, "cover");
    assert.equal(image.getAttribute("width"), "960");
    assert.equal(image.getAttribute("height"), "640");
  } finally { await ui.close(); }
});

test("service cards show descriptions and prices, support checkbox selection, and fall back when a photo fails", async () => {
  const Card = loadTsModule("components/booking/ServiceSelectionCard.tsx", mocks).default;
  const service = { id: "1", name: "Extra mattress", description: "Fresh bedding included", price: 500, imageUrl: "https://images.example.com/mattress.jpg" };
  let toggled = 0;
  const ui = await mount(Card, { service, selected: false, onToggle: () => toggled++ });
  try {
    assert.match(ui.container.textContent, /Extra mattress.*Fresh bedding included.*500\.00/);
    assert.equal(ui.container.querySelector("img").getAttribute("src"), service.imageUrl);
    await act(async () => ui.container.querySelector("input").click()); assert.equal(toggled, 1);
    await act(async () => ui.container.querySelector("img").dispatchEvent(new window.Event("error")));
    assert.equal(ui.container.querySelector("img").getAttribute("src"), "/images/service-placeholder.svg");
    await act(async () => ui.root.render(createElement(Card, { service: { ...service, imageUrl: null }, selected: true, onToggle: () => toggled++ })));
    assert.equal(ui.container.querySelector("input").checked, true);
    assert.equal(ui.container.querySelector("img").getAttribute("src"), "/images/service-placeholder.svg");
  } finally { await ui.close(); }
});

test("customer photo preview opens independently of selection and closes with Escape, backdrop, or close button", async () => {
  const Card = loadTsModule("components/booking/ServiceSelectionCard.tsx", mocks).default;
  let toggled = 0;
  const ui = await mount(Card, { service: { id: "1", name: "Mattress", description: "Fresh linen", price: 500, imageUrl: "https://images.example.com/mattress.jpg" }, selected: false, onToggle: () => toggled++ });
  try {
    for (const method of ["escape", "backdrop", "button"]) {
      const opener = ui.container.querySelector('[aria-label="View Mattress photo"]');
      opener.focus();
      await act(async () => opener.click());
      const dialog = document.querySelector("dialog[open]");
      assert.ok(dialog);
      assert.equal(document.body.style.overflow, "hidden");
      assert.equal(dialog.querySelector("img").getAttribute("src"), "https://images.example.com/mattress.jpg");
      assert.equal(dialog.querySelector("h2").id, dialog.getAttribute("aria-labelledby"));
      await act(async () => dialog.querySelector("img").click());
      assert.ok(document.querySelector("dialog[open]"));
      assert.equal(toggled, 0);
      assert.equal(ui.container.querySelector("input").checked, false);
      await act(async () => {
        if (method === "escape") dialog.dispatchEvent(new window.Event("cancel", { cancelable: true }));
        else if (method === "backdrop") dialog.click();
        else dialog.querySelector('[aria-label="Close photo preview"]').click();
      });
      assert.equal(document.querySelector("dialog"), null);
      assert.equal(document.body.style.overflow, "");
      assert.equal(document.activeElement, opener);
    }
    await act(async () => ui.container.querySelector("input").click());
    assert.equal(toggled, 1);
  } finally { await ui.close(); }
});

for(const [resource,imageField,placeholder] of [["services","image_url","service"],["units","unit_img","unit"]]) test(`${resource} catalog photo upload locks save until complete, saves the new URL, and removal restores the placeholder`, async () => {
  const Editor = loadTsModule("components/admin/catalog/CatalogEditorDialog.tsx", mocks).default;
  const oldFetch = globalThis.fetch;
  let finish, saved;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/admin/settings/images"); assert.ok(options.body.get("file"));
    return new Promise(resolve => { finish = () => resolve(Response.json({ success: true, url: "https://images.example.com/new.jpg" })); });
  };
  const ui = await mount(Editor, { resource, record: { name: "Guest room", price: 500, base_price:8000,capacity:4, is_active: true, [imageField]: "https://images.example.com/old.jpg" }, references: { units: [], paymentMethods: [] }, busy: false, onClose: () => {}, onSave: async draft => { saved = draft; } });
  try {
    const file = ui.container.querySelector('input[type="file"]');
    Object.defineProperty(file, "files", { configurable: true, value: [new File([new Uint8Array([255, 216, 255])], "photo.jpg", { type: "image/jpeg" })] });
    await act(async () => file.dispatchEvent(new window.Event("change", { bubbles: true })));
    assert.equal(ui.container.querySelector('button[type="submit"]').disabled, true);
    assert.equal(ui.container.querySelector('[aria-label="Close dialog"]').disabled, true);
    await act(async () => finish());
    assert.equal(ui.container.querySelector("img").getAttribute("src"), "https://images.example.com/new.jpg");
    await act(async () => ui.container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(saved[imageField], "https://images.example.com/new.jpg");
    await act(async () => [...ui.container.querySelectorAll("button")].find(button => button.textContent === "Remove photo").click());
    assert.equal(ui.container.querySelector("img").getAttribute("src"), `/images/${placeholder}-placeholder.svg`);
    await act(async () => ui.container.querySelector("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
    assert.equal(saved[imageField], "");
  } finally { await ui.close(); globalThis.fetch = oldFetch; }
});

test("room image cards select exactly one room through the photo or radio and recover from broken images",async()=>{
  const Card=loadTsModule("components/booking/UnitSelectionCard.tsx",mocks).default;
  const units=[{id:"a",name:"Garden room",description:"Air-conditioned room",capacity:4,imageUrl:"https://images.example.com/garden.jpg"},{id:"b",name:"Pool room",description:"Near the pool",capacity:2,imageUrl:null}];
  function Choice(){const [selected,setSelected]=useState("a");return createElement("fieldset",null,createElement("legend",null,"Room Type"),...units.map(unit=>createElement(Card,{key:unit.id,unit,selected:unit.id===selected,onSelect:()=>setSelected(unit.id)})));}
  const ui=await mount(Choice,{});
  try{
    const radios=[...ui.container.querySelectorAll('input[type="radio"]')];assert.equal(radios.length,2);assert.equal(radios[0].checked,true);assert.ok(radios.every(r=>r.name==="roomType"&&r.required));
    assert.match(ui.container.textContent,/Room capacity: 4 guests/);assert.match(ui.container.textContent,/Air-conditioned room/);
    assert.equal(ui.container.querySelector("img").getAttribute("src"),units[0].imageUrl);
    await act(async()=>ui.container.querySelectorAll("img")[1].click());assert.equal(radios[1].checked,true);assert.equal(radios[0].checked,false);
    await act(async()=>radios[0].click());assert.equal(radios[0].checked,true);assert.equal(radios[1].checked,false);
    await act(async()=>ui.container.querySelector("img").dispatchEvent(new window.Event("error")));assert.equal(ui.container.querySelector("img").getAttribute("src"),"/images/unit-placeholder.svg");
    units[0]={...units[0],imageUrl:"https://images.example.com/replacement.jpg"};await act(async()=>ui.root.render(createElement(Choice)));assert.equal(ui.container.querySelector("img").getAttribute("src"),units[0].imageUrl);
  }finally{await ui.close();}
});
