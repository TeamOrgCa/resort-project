import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const { publicContentDefaults } = loadTsModule("lib/settings/public-content.ts");
function render({ schedule = null, error = null, overrides = {} } = {}) {
  const content = { ...publicContentDefaults, ...overrides };
  const { default: Rates } = loadTsModule("components/content/ResortRates.tsx", {
    "@/lib/booking/use-package-rates": { usePackageRates: () => ({ schedule, error }) },
    "@/components/content/SiteContent": {
      useSiteContent: () => content,
      contentText: (settings, key) => settings[key],
      SiteText: ({ contentKey }) => content[contentKey],
      SiteImage: ({ contentKey, alt }) => createElement("img", { src: content[contentKey], alt }),
    },
  });
  return renderToStaticMarkup(createElement(Rates));
}

test("About rates display the current schedule for all six packages, including admin price changes", () => {
  const rates = structuredClone(legacyRates);
  rates.weekday.day = { baseRate: 1234.56, addOnPerHead: 78.9 };
  const markup = render({ schedule: { version: 12, rates } });
  assert.match(markup, /₱1,234\.56/); assert.match(markup, /₱78\.9/);
  assert.doesNotMatch(markup, /₱7,500/);
  for (const amount of [8000, 9500, 10000, 14500, 15000]) assert.ok(markup.includes(new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(amount)));
  assert.equal((markup.match(/Includes 20 guests/g) ?? []).length, 6);
  assert.match(markup, /Monday–Thursday/); assert.match(markup, /Friday–Sunday/);
});

test("loading and failed rate requests never substitute old printed prices", () => {
  const loading = render(); const failed = render({ error: "Rates unavailable" });
  assert.match(loading, /Loading current package prices/);
  assert.match(failed, /temporarily unavailable/);
  assert.doesNotMatch(loading + failed, /₱/);
  for (const markup of [loading, failed]) {
    assert.match(markup, /\/rates\/info_marville\.jpg/); assert.match(markup, /\/rates\/pricing_marville\.jpg/);
    assert.match(markup, /Printed prices and payment details may differ/);
  }
});

test("brochures and readable inclusions retain admin-edited content and full-size links", () => {
  const markup = render({ overrides: { "content.about.info_poster": "https://images.example.com/new-guide.jpg", "content.about.inclusions": "Updated cottage\nUpdated food inclusion", "content.about.info_poster_title": "Updated resort guide" } });
  assert.match(markup, /href="https:\/\/images\.example\.com\/new-guide\.jpg"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /<li>Updated cottage<\/li>/); assert.match(markup, /<li>Updated food inclusion<\/li>/);
  assert.match(markup, /Updated resort guide/);
});
