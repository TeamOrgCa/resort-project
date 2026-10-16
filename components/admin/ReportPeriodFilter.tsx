"use client";

import { useState } from "react";
import { manilaDateKey } from "@/lib/booking/manila-date";
import { REPORT_PERIOD_LABELS } from "@/lib/reports/periods";
import { InvalidDateRangeError, parseCustomDateRange } from "@/lib/server/custom-date-range";

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

  return <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
    event.preventDefault();
    try { parseCustomDateRange(startDate, endDate); setError(null); onRangeChange({ startDate, endDate }); }
    catch (cause) { setError(cause instanceof InvalidDateRangeError ? cause.message : "Choose a valid start and end date."); }
  }}>
    <label className="flex flex-col gap-1 text-sm text-neutral/70">Period
      <select value={period} onChange={(event) => { setError(null); onPeriodChange(event.target.value as ReportPeriod); }} className="admin-field">
        {Object.entries(REPORT_PERIOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    {period === "Custom" && <>
      <label className="flex flex-col gap-1 text-sm text-neutral/70">From
        <input type="date" required max={endDate || undefined} value={startDate} onChange={(event) => setStartDate(event.target.value)} className="admin-field" />
      </label>
      <label className="flex flex-col gap-1 text-sm text-neutral/70">Through
        <input type="date" required min={startDate || undefined} value={endDate} onChange={(event) => setEndDate(event.target.value)} className="admin-field" />
      </label>
      <button type="submit" className="admin-button-primary">Apply dates</button>
      <span className="text-xs text-neutral/60">Showing {range.startDate} through {range.endDate}</span>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
    </>}
  </form>;
}
