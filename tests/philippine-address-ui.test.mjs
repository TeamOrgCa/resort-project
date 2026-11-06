import test, { after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState } from "react";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/auth/register" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement; globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const AddressFields = loadTsModule("components/ui/PhilippineAddressFields.tsx").default;
const provinces = [{ code: "0405800000", name: "Rizal" }, { code: "0403400000", name: "Laguna" }];

async function mount(fetcher) {
  const originalFetch = globalThis.fetch; globalThis.fetch = fetcher;
  function Form() {
    const [value, setValue] = useState({ streetAddress: "Block 2", province: "", city: "", zipCode: "" });
    return createElement(AddressFields, { value, onChange: setValue });
  }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(createElement(Form)));
  return {
    container,
    select: (name, value) => act(async () => {
      const field = container.querySelector(`[name="${name}"]`);
      field.value = value;
      field.dispatchEvent(new window.Event("change", { bubbles: true }));
    }),
    close: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = originalFetch; },
  };
}

test("linked locations ignore stale responses and include Metro Manila without Manila subdistricts", async () => {
  let resolveRizal;
  const requests = [];
  const h = await mount(async url => {
    requests.push(url);
    if (url.endsWith("/provinces")) return Response.json(provinces);
    if (url.includes("0405800000")) return new Promise(resolve => { resolveRizal = resolve; });
    if (url.includes("0403400000")) return Response.json([{ code: "0403405000", name: "City of Calamba ", type: "City" }]);
    return Response.json([{ code: "1380600000", name: "City of Manila", type: "City" }, { code: "1380601000", name: "Tondo I/II", type: "SubMun" }]);
  });
  try {
    const city = h.container.querySelector("#city");
    assert.equal(city.disabled, true);
    assert.deepEqual([...h.container.querySelector("#province").options].map(option => option.textContent), ["Select province", "Laguna", "Metro Manila (NCR)", "Rizal"]);
    await h.select("province", "Rizal");
    assert.equal(city.disabled, true);
    assert.match(city.textContent, /Loading/);
    await h.select("province", "");
    assert.equal(city.disabled, true);
    assert.doesNotMatch(city.textContent, /Loading/);
    await h.select("province", "Laguna");
    await h.select("city", "City of Calamba");
    await act(async () => resolveRizal(Response.json([{ code: "0405813000", name: "Taytay", type: "Mun" }])));
    assert.equal(city.value, "City of Calamba");
    assert.doesNotMatch(city.textContent, /Taytay/);
    await h.select("province", "Metro Manila (NCR)");
    assert.equal(city.value, "");
    assert.match(city.textContent, /City of Manila/);
    assert.doesNotMatch(city.textContent, /Tondo/);
    assert.ok(requests.includes("https://psgc.cloud/api/regions/1300000000/cities-municipalities"));
    assert.equal(h.container.querySelector("#streetAddress").value, "Block 2");
  } finally { await h.close(); }
});

test("province and city failures show retry controls and recover without clearing street address", async () => {
  let provinceAttempts = 0, cityAttempts = 0;
  const h = await mount(async url => {
    if (url.endsWith("/provinces")) return ++provinceAttempts === 1
      ? Response.json({}, { status: 503 }) : Response.json(provinces);
    return ++cityAttempts === 1 ? Response.json({ unexpected: "payload" })
      : Response.json([{ code: "0405813000", name: "Taytay", type: "Mun" }]);
  });
  try {
    assert.match(h.container.querySelector('[role="alert"]').textContent, /Unable to load provinces/);
    assert.equal(h.container.querySelector("#province").disabled, true);
    await act(async () => h.container.querySelector("button").click());
    assert.equal(h.container.querySelector("#province").disabled, false);
    await h.select("province", "Rizal");
    assert.match(h.container.querySelector('[role="alert"]').textContent, /Unable to load cities/);
    assert.equal(h.container.querySelector("#city").disabled, true);
    await act(async () => h.container.querySelector("button").click());
    assert.equal(h.container.querySelector('[role="alert"]'), null);
    assert.equal(h.container.querySelector("#city").disabled, false);
    await h.select("city", "Taytay");
    assert.equal(h.container.querySelector("#city").value, "Taytay");
    assert.equal(h.container.querySelector("#streetAddress").value, "Block 2");
  } finally { await h.close(); }
});
