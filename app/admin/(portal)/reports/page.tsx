"use client";

import { useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableFilter, AdminTableRow, AdminTableSort } from "@/components/admin/types";

type ReportTab = "Sales Report" | "Financial Report" | "Guest Report" | "Staff Report";
type PeriodFilter = "Daily" | "Weekly" | "Monthly";

interface ReportVisualData {
  trend: { label: string; value: number }[];
  split: { label: string; value: number }[];
}

interface ReportTableConfig {
  columns: AdminTableColumn[];
  rowsByPeriod: Record<PeriodFilter, AdminTableRow[]>;
  filters?: AdminTableFilter[];
  defaultSort: AdminTableSort;
}

const reportTabs: { title: ReportTab; description: string }[] = [
  {
    title: "Sales Report",
    description: "Revenue by period and service category with booking volume context.",
  },
  {
    title: "Financial Report",
    description: "Cash flow visibility for received payments, balances, and pending collections.",
  },
  {
    title: "Guest Report",
    description: "Guest composition, visit behavior, and booking channel trends.",
  },
  {
    title: "Staff Report",
    description: "Operational activity and accountability metrics per authorized personnel.",
  },
];

const reportVisuals: Record<ReportTab, Record<PeriodFilter, ReportVisualData>> = {
  "Sales Report": {
    Daily: {
      trend: [
        { label: "Mon", value: 62 },
        { label: "Tue", value: 58 },
        { label: "Wed", value: 74 },
        { label: "Thu", value: 69 },
        { label: "Fri", value: 88 },
      ],
      split: [
        { label: "Accommodation", value: 48 },
        { label: "Amenities", value: 31 },
        { label: "Public Access", value: 21 },
      ],
    },
    Weekly: {
      trend: [
        { label: "W1", value: 71 },
        { label: "W2", value: 77 },
        { label: "W3", value: 74 },
        { label: "W4", value: 86 },
      ],
      split: [
        { label: "Accommodation", value: 51 },
        { label: "Amenities", value: 28 },
        { label: "Public Access", value: 21 },
      ],
    },
    Monthly: {
      trend: [
        { label: "Jan", value: 66 },
        { label: "Feb", value: 72 },
        { label: "Mar", value: 84 },
      ],
      split: [
        { label: "Accommodation", value: 54 },
        { label: "Amenities", value: 27 },
        { label: "Public Access", value: 19 },
      ],
    },
  },
  "Financial Report": {
    Daily: {
      trend: [
        { label: "Mon", value: 57 },
        { label: "Tue", value: 61 },
        { label: "Wed", value: 64 },
        { label: "Thu", value: 59 },
        { label: "Fri", value: 73 },
      ],
      split: [
        { label: "Received", value: 64 },
        { label: "Pending", value: 24 },
        { label: "Adjustments", value: 12 },
      ],
    },
    Weekly: {
      trend: [
        { label: "W1", value: 62 },
        { label: "W2", value: 66 },
        { label: "W3", value: 71 },
        { label: "W4", value: 78 },
      ],
      split: [
        { label: "Received", value: 68 },
        { label: "Pending", value: 22 },
        { label: "Adjustments", value: 10 },
      ],
    },
    Monthly: {
      trend: [
        { label: "Jan", value: 61 },
        { label: "Feb", value: 65 },
        { label: "Mar", value: 79 },
      ],
      split: [
        { label: "Received", value: 71 },
        { label: "Pending", value: 20 },
        { label: "Adjustments", value: 9 },
      ],
    },
  },
  "Guest Report": {
    Daily: {
      trend: [
        { label: "Mon", value: 44 },
        { label: "Tue", value: 39 },
        { label: "Wed", value: 47 },
        { label: "Thu", value: 51 },
        { label: "Fri", value: 64 },
      ],
      split: [
        { label: "New Guests", value: 59 },
        { label: "Returning", value: 41 },
      ],
    },
    Weekly: {
      trend: [
        { label: "W1", value: 52 },
        { label: "W2", value: 49 },
        { label: "W3", value: 57 },
        { label: "W4", value: 63 },
      ],
      split: [
        { label: "New Guests", value: 56 },
        { label: "Returning", value: 44 },
      ],
    },
    Monthly: {
      trend: [
        { label: "Jan", value: 48 },
        { label: "Feb", value: 54 },
        { label: "Mar", value: 61 },
      ],
      split: [
        { label: "New Guests", value: 53 },
        { label: "Returning", value: 47 },
      ],
    },
  },
  "Staff Report": {
    Daily: {
      trend: [
        { label: "Mon", value: 58 },
        { label: "Tue", value: 63 },
        { label: "Wed", value: 61 },
        { label: "Thu", value: 66 },
        { label: "Fri", value: 75 },
      ],
      split: [
        { label: "Reservations", value: 46 },
        { label: "Transactions", value: 32 },
        { label: "Schedules", value: 22 },
      ],
    },
    Weekly: {
      trend: [
        { label: "W1", value: 61 },
        { label: "W2", value: 64 },
        { label: "W3", value: 69 },
        { label: "W4", value: 74 },
      ],
      split: [
        { label: "Reservations", value: 42 },
        { label: "Transactions", value: 35 },
        { label: "Schedules", value: 23 },
      ],
    },
    Monthly: {
      trend: [
        { label: "Jan", value: 60 },
        { label: "Feb", value: 67 },
        { label: "Mar", value: 73 },
      ],
      split: [
        { label: "Reservations", value: 44 },
        { label: "Transactions", value: 34 },
        { label: "Schedules", value: 22 },
      ],
    },
  },
};

const reportTables: Record<ReportTab, ReportTableConfig> = {
  "Sales Report": {
    columns: [
      { key: "category", label: "Category" },
      { key: "revenue", label: "Revenue" },
      { key: "bookings", label: "Bookings" },
      { key: "growth", label: "Growth" },
    ],
    rowsByPeriod: {
      Daily: [
        { id: "s-d-1", category: "Accommodation", revenue: "₱182,000", bookings: "24", growth: "+6%" },
        { id: "s-d-2", category: "Amenities", revenue: "₱94,300", bookings: "41", growth: "+9%" },
      ],
      Weekly: [
        { id: "s-w-1", category: "Accommodation", revenue: "₱1,041,000", bookings: "126", growth: "+8%" },
        { id: "s-w-2", category: "Amenities", revenue: "₱566,000", bookings: "224", growth: "+7%" },
      ],
      Monthly: [
        { id: "s-m-1", category: "Accommodation", revenue: "₱4,210,000", bookings: "512", growth: "+11%" },
        { id: "s-m-2", category: "Amenities", revenue: "₱2,280,000", bookings: "891", growth: "+10%" },
      ],
    },
    filters: [{ key: "category", label: "Category", options: ["Accommodation", "Amenities", "Public Access"] }],
    defaultSort: { key: "revenue", direction: "desc" },
  },
  "Financial Report": {
    columns: [
      { key: "item", label: "Item" },
      { key: "received", label: "Received" },
      { key: "outstanding", label: "Outstanding" },
      { key: "status", label: "Status" },
    ],
    rowsByPeriod: {
      Daily: [
        { id: "f-d-1", item: "Reservation Payments", received: "₱128,400", outstanding: "₱46,200", status: "Tracked" },
        { id: "f-d-2", item: "Additional Charges", received: "₱22,800", outstanding: "₱8,400", status: "Tracked" },
      ],
      Weekly: [
        { id: "f-w-1", item: "Reservation Payments", received: "₱821,700", outstanding: "₱192,000", status: "Tracked" },
        { id: "f-w-2", item: "Additional Charges", received: "₱141,600", outstanding: "₱39,200", status: "Tracked" },
      ],
      Monthly: [
        { id: "f-m-1", item: "Reservation Payments", received: "₱3,281,500", outstanding: "₱604,900", status: "Tracked" },
        { id: "f-m-2", item: "Additional Charges", received: "₱612,300", outstanding: "₱173,100", status: "Tracked" },
      ],
    },
    filters: [{ key: "status", label: "Status", options: ["Tracked"] }],
    defaultSort: { key: "received", direction: "desc" },
  },
  "Guest Report": {
    columns: [
      { key: "segment", label: "Segment" },
      { key: "count", label: "Count" },
      { key: "averageStay", label: "Avg Stay" },
      { key: "trend", label: "Trend" },
    ],
    rowsByPeriod: {
      Daily: [
        { id: "g-d-1", segment: "First-time", count: "39", averageStay: "2.2 nights", trend: "+5%" },
        { id: "g-d-2", segment: "Returning", count: "27", averageStay: "3.1 nights", trend: "+3%" },
      ],
      Weekly: [
        { id: "g-w-1", segment: "First-time", count: "238", averageStay: "2.4 nights", trend: "+6%" },
        { id: "g-w-2", segment: "Returning", count: "189", averageStay: "3.0 nights", trend: "+4%" },
      ],
      Monthly: [
        { id: "g-m-1", segment: "First-time", count: "981", averageStay: "2.5 nights", trend: "+8%" },
        { id: "g-m-2", segment: "Returning", count: "842", averageStay: "3.2 nights", trend: "+6%" },
      ],
    },
    filters: [{ key: "segment", label: "Segment", options: ["First-time", "Returning"] }],
    defaultSort: { key: "count", direction: "desc" },
  },
  "Staff Report": {
    columns: [
      { key: "staff", label: "Staff" },
      { key: "actions", label: "Logged Actions" },
      { key: "shift", label: "Shift" },
      { key: "attendance", label: "Attendance" },
    ],
    rowsByPeriod: {
      Daily: [
        { id: "st-d-1", staff: "Alex Mendoza", actions: "34", shift: "Morning", attendance: "Present" },
        { id: "st-d-2", staff: "Bea Navarro", actions: "29", shift: "Afternoon", attendance: "Present" },
      ],
      Weekly: [
        { id: "st-w-1", staff: "Alex Mendoza", actions: "201", shift: "Morning", attendance: "6/6" },
        { id: "st-w-2", staff: "Bea Navarro", actions: "184", shift: "Afternoon", attendance: "6/6" },
      ],
      Monthly: [
        { id: "st-m-1", staff: "Alex Mendoza", actions: "823", shift: "Morning", attendance: "24/24" },
        { id: "st-m-2", staff: "Bea Navarro", actions: "756", shift: "Afternoon", attendance: "23/24" },
      ],
    },
    filters: [{ key: "shift", label: "Shift", options: ["Morning", "Afternoon", "Night"] }],
    defaultSort: { key: "actions", direction: "desc" },
  },
};

export default function AdminReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>("Sales Report");
  const [period, setPeriod] = useState<PeriodFilter>("Daily");

  const visualData = reportVisuals[activeTab][period];
  const tableConfig = reportTables[activeTab];

  const splitTotal = useMemo(
    () => visualData.split.reduce((total, item) => total + item.value, 0),
    [visualData.split]
  );

  const pieStops = useMemo(() => {
    const colors = ["var(--color-secondary)", "var(--color-highlight)", "var(--color-primary)", "var(--color-accent)"];

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
        title="Administrative Reports"
        subtitle="Generate period-based reports to monitor operations, revenue, and staff accountability."
      />

      <section className="rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral/10 pb-4">
          <div className="flex flex-wrap gap-2">
            {reportTabs.map((tab) => {
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
          {reportTabs.find((tab) => tab.title === activeTab)?.description}
        </p>

        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-neutral/10 bg-base p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral">{activeTab} Trend ({period})</h3>
            <div className="mt-3 grid grid-cols-5 gap-2">
              {visualData.trend.map((point) => (
                <div key={point.label} className="flex flex-col items-center gap-2">
                  <div className="flex h-32 w-full items-end rounded-lg bg-white px-2 py-2">
                    <div className="w-full rounded-md bg-primary" style={{ height: `${point.value}%` }} />
                  </div>
                  <span className="text-xs text-neutral/70">{point.label}</span>
                </div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-neutral/10 bg-base p-4">
            <h3 className="text-sm font-semibold text-neutral">Category Split</h3>
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
            actions={["Generate Report", "Export CSV"]}
            rowActions={["Open"]}
          />
        </div>
      </section>
    </div>
  );
}
