import { manilaDateKey } from "@/lib/booking/manila-date";
export const DAY_MS = 86400000;
export const round = (value: number) => Math.round(value * 100) / 100;
export const percentage = (part: number, total: number) => total ? round(part / total * 100) : 0;
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}
export function changeLabel(current: number, previous: number, suffix = "") {
  if (!previous) return current ? "New activity; previous period had none" : "No activity in either period";
  const delta = round((current - previous) / previous * 100);
  return `${delta > 0 ? "+" : ""}${delta}%${suffix} (${previous.toLocaleString("en-PH")} previously)`;
}
type Day = { date: string; value: number };
const weekday = (date: string) => new Date(`${date}T12:00:00+08:00`).getUTCDay();
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
function model(days: Day[]) {
  const active = days.filter(day => day.value > 0).length;
  const seasonal = days.length >= 28 && active >= 14;
  return {
    name: seasonal ? "Day-of-week average" : "Daily average (limited history)",
    predict: (date: string) => round(mean((seasonal ? days.filter(day => weekday(day.date) === weekday(date)) : days).map(day => day.value))),
  };
}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction;
  return round(sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1));
}
/** No external prediction service: all estimates are reproducible from saved collections. */
export function collectionForecast(days: Day[], start: Date, horizon: number) {
  const fitted = model(days);
  const points = Array.from({ length: horizon }, (_, i) => {
    const date = manilaDateKey(new Date(start.getTime() + i * DAY_MS));
    return { label: date, value: fitted.predict(date) };
  });
  const estimate = round(points.reduce((sum, day) => sum + day.value, 0));
  const rolling = Array.from({ length: Math.max(0, days.length - horizon + 1) }, (_, i) =>
    round(days.slice(i, i + horizon).reduce((sum, day) => sum + day.value, 0)));
  // Historical percentiles are activity scenarios, not statistical confidence bounds.
  const lower = rolling.length >= 2 ? percentile(rolling, .25) : null;
  const upper = rolling.length >= 2 ? percentile(rolling, .75) : null;
  const training = days.slice(0, -7), holdout = days.slice(-7);
  const backtest = days.length >= 14 && training.filter(day => day.value > 0).length >= 7
    ? (() => {
      const earlier = model(training), errors = holdout.map(day => Math.abs(earlier.predict(day.date) - day.value));
      return { mae: round(mean(errors)), actual: round(holdout.reduce((sum, day) => sum + day.value, 0)), estimated: round(holdout.reduce((sum, day) => sum + earlier.predict(day.date), 0)), days: holdout.length };
    })() : null;
  return { method: fitted.name, points, estimate, lower, upper, backtest, activeDays: days.filter(day => day.value > 0).length, historyDays: days.length };
}
