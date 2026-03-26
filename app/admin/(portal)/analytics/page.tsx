"use client";

import { useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableFilter, AdminTableRow, AdminTableSort } from "@/components/admin/types";

type AnalyticsTab = "Booking Trend Analysis" | "Revenue Forecasting" | "Performance Signals";
type PeriodFilter = "Daily" | "Weekly" | "Monthly";

interface AnalyticsVisualData {
  trend: { label: string; value: number }[];
  split: { label: string; value: number }[];
}

interface AnalyticsTableConfig {
  columns: AdminTableColumn[];
  rowsByPeriod: Record<PeriodFilter, AdminTableRow[]>;
  filters?: AdminTableFilter[];
  defaultSort: AdminTableSort;
}

const analyticsTabs: { title: AnalyticsTab; description: string }[] = [
  {
    title: "Booking Trend Analysis",
    description: "Analyze booking movement and demand timing patterns across selected periods.",
  },
  {
    title: "Revenue Forecasting",
    description: "Project expected revenue and booking count based on historical and current activity.",
  },
  {
    title: "Performance Signals",
    description: "Track operational alerts and utilization pressure points requiring action.",
  },
];

const analyticsVisuals: Record<AnalyticsTab, Record<PeriodFilter, AnalyticsVisualData>> = {
  "Booking Trend Analysis": {
    Daily: {
      trend: [
        { label: "Mon", value: 44 },
        { label: "Tue", value: 39 },
        { label: "Wed", value: 53 },
        { label: "Thu", value: 48 },
        { label: "Fri", value: 66 },
      ],
      split: [
        { label: "Website", value: 58 },
        { label: "Walk-in", value: 27 },
        { label: "Assisted", value: 15 },
      ],
    },
    Weekly: {
      trend: [
        { label: "W1", value: 59 },
        { label: "W2", value: 62 },
        { label: "W3", value: 67 },
        { label: "W4", value: 74 },
      ],
      split: [
        { label: "Website", value: 56 },
        { label: "Walk-in", value: 29 },
        { label: "Assisted", value: 15 },
      ],
    },
    Monthly: {
      trend: [
        { label: "Jan", value: 61 },
        { label: "Feb", value: 66 },
        { label: "Mar", value: 77 },
      ],
      split: [
        { label: "Website", value: 54 },
        { label: "Walk-in", value: 31 },
        { label: "Assisted", value: 15 },
      ],
    },
  },
  "Revenue Forecasting": {
    Daily: {
      trend: [
        { label: "Mon", value: 57 },
        { label: "Tue", value: 61 },
        { label: "Wed", value: 65 },
        { label: "Thu", value: 62 },
        { label: "Fri", value: 78 },
      ],
      split: [
        { label: "High Confidence", value: 52 },
        { label: "Medium Confidence", value: 33 },
        { label: "Low Confidence", value: 15 },
      ],
    },
    Weekly: {
      trend: [
        { label: "W1", value: 66 },
        { label: "W2", value: 68 },
        { label: "W3", value: 73 },
        { label: "W4", value: 81 },
      ],
      split: [
        { label: "High Confidence", value: 55 },
        { label: "Medium Confidence", value: 31 },
        { label: "Low Confidence", value: 14 },
      ],
    },
    Monthly: {
      trend: [
        { label: "Jan", value: 63 },
        { label: "Feb", value: 71 },
        { label: "Mar", value: 84 },
      ],
      split: [
        { label: "High Confidence", value: 58 },
        { label: "Medium Confidence", value: 30 },
        { label: "Low Confidence", value: 12 },
      ],
    },
  },
  "Performance Signals": {
    Daily: {
      trend: [
        { label: "Mon", value: 36 },
        { label: "Tue", value: 41 },
        { label: "Wed", value: 47 },
        { label: "Thu", value: 45 },
        { label: "Fri", value: 55 },
      ],
      split: [
        { label: "Normal", value: 62 },
        { label: "Watch", value: 25 },
        { label: "Critical", value: 13 },
      ],
    },
    Weekly: {
      trend: [
        { label: "W1", value: 43 },
        { label: "W2", value: 46 },
        { label: "W3", value: 51 },
        { label: "W4", value: 58 },
      ],
      split: [
        { label: "Normal", value: 59 },
        { label: "Watch", value: 28 },
        { label: "Critical", value: 13 },
      ],
    },
    Monthly: {
      trend: [
        { label: "Jan", value: 46 },
        { label: "Feb", value: 52 },
        { label: "Mar", value: 61 },
      ],
      split: [
        { label: "Normal", value: 57 },
        { label: "Watch", value: 30 },
        { label: "Critical", value: 13 },
      ],
    },
  },
};

const analyticsTables: Record<AnalyticsTab, AnalyticsTableConfig> = {
  "Booking Trend Analysis": {
    columns: [
      { key: "segment", label: "Segment" },
      { key: "bookings", label: "Bookings" },
      { key: "averageLead", label: "Avg Lead Time" },
      { key: "change", label: "Change" },
    ],
    rowsByPeriod: {
      Daily: [
        { id: "bt-d-1", segment: "Weekend", bookings: "48", averageLead: "5 days", change: "+8%" },
        { id: "bt-d-2", segment: "Weekday", bookings: "26", averageLead: "3 days", change: "+4%" },
      ],
      Weekly: [
        { id: "bt-w-1", segment: "Weekend", bookings: "214", averageLead: "6 days", change: "+9%" },
        { id: "bt-w-2", segment: "Weekday", bookings: "139", averageLead: "4 days", change: "+5%" },
      ],
      Monthly: [
        { id: "bt-m-1", segment: "Weekend", bookings: "842", averageLead: "7 days", change: "+11%" },
        { id: "bt-m-2", segment: "Weekday", bookings: "517", averageLead: "5 days", change: "+6%" },
      ],
    },
    filters: [{ key: "segment", label: "Segment", options: ["Weekend", "Weekday"] }],
    defaultSort: { key: "bookings", direction: "desc" },
  },
  "Revenue Forecasting": {
    columns: [
      { key: "periodLabel", label: "Forecast Window" },
      { key: "projectedBookings", label: "Projected Bookings" },
      { key: "projectedRevenue", label: "Projected Revenue" },
      { key: "confidence", label: "Confidence" },
    ],
    rowsByPeriod: {
      Daily: [
        { id: "rf-d-1", periodLabel: "Next 24h", projectedBookings: "16", projectedRevenue: "₱148,000", confidence: "High" },
        { id: "rf-d-2", periodLabel: "+24h to +48h", projectedBookings: "13", projectedRevenue: "₱126,000", confidence: "Medium" },
      ],
      Weekly: [
        { id: "rf-w-1", periodLabel: "Next 7 days", projectedBookings: "93", projectedRevenue: "₱912,400", confidence: "High" },
        { id: "rf-w-2", periodLabel: "Following 7 days", projectedBookings: "81", projectedRevenue: "₱801,900", confidence: "Medium" },
      ],
      Monthly: [
        { id: "rf-m-1", periodLabel: "Next 30 days", projectedBookings: "391", projectedRevenue: "₱3,412,000", confidence: "High" },
        { id: "rf-m-2", periodLabel: "31-60 days", projectedBookings: "352", projectedRevenue: "₱3,086,500", confidence: "Medium" },
      ],
    },
    filters: [{ key: "confidence", label: "Confidence", options: ["High", "Medium", "Low"] }],
    defaultSort: { key: "projectedRevenue", direction: "desc" },
  },
  "Performance Signals": {
    columns: [
      { key: "signal", label: "Signal" },
      { key: "value", label: "Current Value" },
      { key: "threshold", label: "Threshold" },
      { key: "severity", label: "Severity" },
    ],
    rowsByPeriod: {
      Daily: [
        { id: "ps-d-1", signal: "Public Access Utilization", value: "85%", threshold: "80%", severity: "Watch" },
        { id: "ps-d-2", signal: "Pending Payment Queue", value: "14", threshold: "10", severity: "Watch" },
      ],
      Weekly: [
        { id: "ps-w-1", signal: "Weekend Occupancy", value: "91%", threshold: "88%", severity: "Critical" },
        { id: "ps-w-2", signal: "Unverified Payments", value: "42", threshold: "35", severity: "Watch" },
      ],
      Monthly: [
        { id: "ps-m-1", signal: "Peak Day Congestion", value: "96%", threshold: "90%", severity: "Critical" },
        { id: "ps-m-2", signal: "Staff Load Index", value: "79%", threshold: "75%", severity: "Watch" },
      ],
    },
    filters: [{ key: "severity", label: "Severity", options: ["Normal", "Watch", "Critical"] }],
    defaultSort: { key: "severity", direction: "desc" },
  },
};

export default function AdminAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("Booking Trend Analysis");
  const [period, setPeriod] = useState<PeriodFilter>("Daily");

  const visualData = analyticsVisuals[activeTab][period];
  const tableConfig = analyticsTables[activeTab];

  const splitTotal = useMemo(
    () => visualData.split.reduce((total, item) => total + item.value, 0),
    [visualData.split]
  );

  const pieStops = useMemo(() => {
    const colors = ["var(--color-accent)", "var(--color-highlight)", "var(--color-primary)", "var(--color-secondary)"];

    const gradientState = visualData.split.reduce(
      (state, item, index) => {
        const segment = (item.value / splitTotal) * 100;
        const start = state.offset;
        const end = state.offset + segment;

        return {
          offset: end,
          stops: [...state.stops, `${colors[index % colors.length]} ${start}% ${end}%`],
        };
      },
      { offset: 0, stops: [] as string[] }
    );

    return gradientState.stops.join(", ");
  }, [splitTotal, visualData.split]);

  return (
    <div>
      <AdminSectionHeader
        title="Business Analytics and Sales Forecasting"
        subtitle="Use AI-enhanced insights to support operational and managerial decision-making."
      />

      <section className="rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral/10 pb-4">
          <div className="flex flex-wrap gap-2">
            {analyticsTabs.map((tab) => {
              const isActive = tab.title === activeTab;

              return (
                <button
                  key={tab.title}
                  type="button"
                  onClick={() => setActiveTab(tab.title)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                    isActive ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"
                  }`}
                >
                  {tab.title}
                </button>
              );
            })}
          </div>

          <label className="flex items-center gap-2 text-sm text-neutral/70">
            <span>Period</span>
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as PeriodFilter)}
              className="rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral"
            >
              <option value="Daily">Daily</option>
              <option value="Weekly">Weekly</option>
              <option value="Monthly">Monthly</option>
            </select>
          </label>
        </div>

        <p className="mb-4 text-sm text-neutral/70">
          {analyticsTabs.find((tab) => tab.title === activeTab)?.description}
        </p>

        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-neutral/10 bg-base p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral">{activeTab} Trend ({period})</h3>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {visualData.trend.map((point) => (
                <div key={point.label} className="flex flex-col items-center gap-2">
                  <div className="flex h-32 w-full items-end rounded-lg bg-white px-2 py-2">
                    <div className="w-full rounded-md bg-accent" style={{ height: `${point.value}%` }} />
                  </div>
                  <span className="text-xs text-neutral/70">{point.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-neutral/10 bg-base p-4">
            <h3 className="text-sm font-semibold text-neutral">Signal Split</h3>
            <div className="mx-auto mt-3 h-36 w-36 rounded-full" style={{ background: `conic-gradient(${pieStops})` }} />
            <ul className="mt-3 space-y-1 text-xs text-neutral/80">
              {visualData.split.map((item) => (
                <li key={item.label}>
                  {item.label}: {Math.round((item.value / splitTotal) * 100)}%
                </li>
              ))}
            </ul>
          </article>
        </div>

        <div className="mt-6">
          <AdminTablePreview
            title={`${activeTab} Snapshot (${period})`}
            columns={tableConfig.columns}
            rows={tableConfig.rowsByPeriod[period]}
            filters={tableConfig.filters}
            defaultSort={tableConfig.defaultSort}
            actions={["Run Forecast", "Export Summary"]}
            rowActions={["Inspect"]}
          />
        </div>
      </section>
    </div>
  );
}
