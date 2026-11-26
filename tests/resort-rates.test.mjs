import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
import { legacyRates } from "./helpers/package-rates.mjs";

const { publicContentDefaults } = loadTsModule("lib/settings/public-content.ts");
function render({ schedule = null, error = null, overrides = {}, resortRates = null, resortError = "Prices unavailable" } = {}) {
  const content = { ...publicContentDefaults, ...overrides };
  const { default: Rates } = loadTsModule("components/content/ResortRates.tsx", {
    "@/lib/booking/use-resort-rates": { useResortRates: () => ({ rates: resortRates, error: resortError }) },
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
  assert.match(loading, /aria-busy="true"/); assert.match(loading, /animate-pulse/);
  assert.doesNotMatch(failed, /animate-pulse/);
  assert.match(failed, /temporarily unavailable/);
  assert.doesNotMatch(loading + failed, /₱/);
  for (const markup of [loading, failed]) {
    assert.doesNotMatch(markup, /\/rates\/(info|pricing)_marville\.jpg/);
    assert.doesNotMatch(markup, /Printed prices and payment details may differ/);
  }
});

test("readable inclusions retain admin edits while legacy brochure settings cannot restore the removed section", () => {
  const markup = render({ overrides: { "content.about.info_poster": "https://images.example.com/new-guide.jpg", "content.about.inclusions": "Updated cottage\nUpdated food inclusion", "content.about.info_poster_title": "Updated resort guide" } });
  assert.doesNotMatch(markup, /new-guide\.jpg|Updated resort guide|Open full size|Resort guides/);
  assert.match(markup, /<li>Updated cottage<\/li>/); assert.match(markup, /<li>Updated food inclusion<\/li>/);
});

test("website configuration and public content no longer offer brochure fields",()=>{
  const {settingDefinitions}=loadTsModule("lib/settings/catalog.ts");
  const {contentSections}=loadTsModule("lib/settings/content-layout.ts");
  const removed=["posters_heading","posters_description","posters_note","info_poster","info_poster_title","pricing_poster","pricing_poster_title"].map(key=>"content.about."+key);
  for(const key of removed){assert.equal(key in publicContentDefaults,false);assert.ok(!settingDefinitions.some(definition=>definition.key===key));}
  const sections=contentSections("About page",settingDefinitions.filter(definition=>definition.group==="About page"));
  assert.ok(!sections.some(section=>section.id==="brochures"));assert.ok(sections.some(section=>section.id==="rates"));
});

test("About rates show configured public admission hours and room-only prices without mixing package inclusions", () => {
 const resortRates={
  publicSwimming:[
   {type_id:"day",mode:"day",name:"Day Admission",start_time:"09:30:00",end_time:"17:00:00",end_day_offset:0,adult_rate:175,child_rate:95},
   {type_id:"night",mode:"night",name:"Night Admission",start_time:"19:00:00",end_time:"00:30:00",end_day_offset:1,adult_rate:225,child_rate:0},
  ],
  rooms:[{classification_id:"standard",code:"standard",name:"Standard Room",included_capacity:2,maximum_capacity:3,rate_3_hours:345,rate_12_hours:1234,additional_guest_rate:175,extension_hourly_rate:125}],
 };
 const markup=render({resortRates,resortError:null});
 assert.match(markup,/Public Swimming/);assert.match(markup,/Room Accommodation Only/);
 for(const amount of [175,95,225,0,345,1234,125]) assert.ok(markup.includes(new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP"}).format(amount)));
 assert.match(markup,/9:30.*AM/);assert.match(markup,/12:30.*AM.*next day/);
 assert.match(markup,/2 guests included.*Up to.*3.*guests per room/);
 assert.match(markup,/3-hour stay/);assert.match(markup,/12-hour stay/);assert.doesNotMatch(markup,/8-hour stay/);
 assert.match(markup,/Full payment is required/);assert.match(markup,/Rooms are optional and charged separately/);
 assert.match(markup,/id="private-swimming-rates"/);assert.match(markup,/id="public-swimming-rates"/);assert.match(markup,/id="room-accommodation-rates"/);
});

test("public and room prices have loading, failure and empty states independent of private packages",()=>{
 const loading=render({resortError:null}),failed=render({resortError:"Current prices unavailable"}),empty=render({resortRates:{publicSwimming:[],rooms:[]}});
 assert.match(loading,/Loading public swimming prices/);assert.match(loading,/Loading room accommodation prices/);
 assert.match(failed,/Current prices unavailable/);assert.doesNotMatch(failed,/per person<\/span>/);
 assert.match(empty,/Public swimming is currently unavailable/);assert.match(empty,/Room accommodation is currently unavailable/);
});
