import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const { matchesBookingSearch, matchesOcularSearch } = loadTsModule("lib/booking/manage-search.ts");
const stay = { reference: "MV-NIGHT", startDatetime: "2026-11-13T16:00:00Z", endDatetime: "2026-11-15T16:00:00Z" };

test("guest date search uses occupied Manila dates across multiple nights and excludes midnight checkout", () => {
  assert.equal(matchesBookingSearch(stay, "2026-11-13"), false);
  for (const date of ["2026-11-14", "2026-11-15"]) {
    assert.equal(matchesBookingSearch(stay, date), true);
    assert.equal(matchesBookingSearch(stay, " night ", date), true);
  }
  assert.equal(matchesBookingSearch(stay, "2026-11-16"), false);
  assert.equal(matchesBookingSearch(stay, "", "2026-11-16"), false);
  assert.equal(matchesBookingSearch(stay, "unknown", "2026-11-14"), false);
  assert.equal(matchesBookingSearch(stay, "Nov 14, 2026"), true);
});

test("ocular date searches match the scheduled Philippine date without shifting it", () => {
  const visit = { reference: "OC-VISIT", scheduledDate: "2026-11-14" };
  assert.equal(matchesOcularSearch(visit, "2026-11-14"), true);
  assert.equal(matchesOcularSearch(visit, "visit", "2026-11-14"), true);
  assert.equal(matchesOcularSearch(visit, "visit", "2026-11-15"), false);
});
