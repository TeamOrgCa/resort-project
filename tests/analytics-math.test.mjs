import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule } from "./helpers/load-ts-module.mjs";
const { collectionForecast, median, percentage, changeLabel } = loadTsModule("lib/reports/analytics-math.ts");
const day = 86400000, start = new Date("2026-10-01T00:00:00+08:00");
const history = values => values.map((value, i) => ({ date: new Date(start.getTime() + i * day).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }), value }));

test("weekday patterns influence daily predictions while zero-collection days stay in the denominator", () => {
  const days = history(Array.from({ length: 56 }, (_, i) => new Date(start.getTime() + i * day + day / 2).getUTCDay() === 5 ? 700 : 100));
  const forecast = collectionForecast(days, new Date(start.getTime() + 56 * day), 7);
  assert.equal(forecast.method, "Day-of-week average");
  assert.equal(forecast.estimate, 1300);
  assert.deepEqual(forecast.points.map(p => p.value), days.slice(0, 7).map(p => p.value));
  const sparse = collectionForecast(history([700, ...Array(55).fill(0)]), start, 7);
  assert.equal(sparse.method, "Daily average (limited history)");
  assert.equal(sparse.estimate, 87.5, "700 / 56 days times 7, not 700 per active day");
  assert.equal(sparse.backtest, null);
});

test("held-out forecast check fits only earlier history and records absolute error", () => {
  const original = collectionForecast(history(Array(56).fill(100)), start, 7);
  const changed = collectionForecast(history([...Array(49).fill(100), ...Array(7).fill(1000)]), start, 7);
  assert.equal(original.backtest.mae, 0);
  assert.equal(changed.backtest.estimated, 700, "Later observations cannot improve the held-out prediction");
  assert.equal(changed.backtest.actual, 7000);
  assert.equal(changed.backtest.mae, 900);
  assert.ok(changed.estimate > original.estimate, "Final production estimate uses all completed history");
});

test("scenario percentiles represent observed rolling activity and small denominators are honest", () => {
  const forecast = collectionForecast(history([0, 0, 100, 300]), start, 1);
  assert.equal(forecast.lower, 0); assert.equal(forecast.upper, 150);
  assert.equal(median([]), null); assert.equal(median([1, 100, 2, 3]), 2.5);
  assert.equal(percentage(1, 3), 33.33);
  assert.match(changeLabel(3, 0), /previous period had none/);
  assert.equal(changeLabel(0, 0), "No activity in either period");
});
