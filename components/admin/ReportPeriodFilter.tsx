"use client";

import { useState } from "react";
import { manilaDateKey } from "@/lib/booking/manila-date";

export type ReportPeriod = "Daily" | "Weekly" | "Monthly" | "Custom";
export type ReportDateRange = { startDate: string; endDate: string };

export function defaultReportDateRange(): ReportDateRange {
  return { startDate: manilaDateKey(new Date(Date.now() - 6 * 86_400_000)), endDate: manilaDateKey(new Date()) };
}

export default function ReportPeriodFilter({ period, range, onPeriodChange, onRangeChange }: {
  period: ReportPeriod;
  range: ReportDateRange;
  onPeriodChange: (period: ReportPeriod) => void;
  onRangeChange: (range: ReportDateRange) => void;
}) {
  const [startDate, setStartDate] = useState(range.startDate);
  const [endDate, setEndDate] = useState(range.endDate);
  const [error, setError] = useState<string | null>(null);

  return <div className="flex flex-wrap items-end gap-2">
    <label className="flex flex-col gap-1 text-sm text-neutral/70">Period
      <select value={period} onChange={(event) => { setError(null); onPeriodChange(event.target.value as ReportPeriod); }} className="rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral">
        <option value="Daily">Daily</option><option value="Weekly">Weekly</option><option value="Monthly">Monthly</option><option value="Custom">Custom date range</option>
      </select>
    </label>
    {period === "Custom" && <>
      <label className="flex flex-col gap-1 text-sm text-neutral/70">From
        <input type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} className="rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-neutral/70">Through
        <input type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} className="rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral" />
      </label>
      <button type="button" onClick={() => {
        if (!startDate || !endDate || startDate > endDate) { setError("Choose a valid start and end date."); return; }
        setError(null); onRangeChange({ startDate, endDate });
      }} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base">Apply range</button>
      <span className="text-xs text-neutral/60">Showing {range.startDate} through {range.endDate}</span>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </>}
  </div>;
}
