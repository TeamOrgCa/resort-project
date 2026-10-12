"use client";

import { useEffect, useMemo, useState } from "react";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow, AdminTableSort } from "@/components/admin/types";
import ReportPeriodFilter, { defaultReportDateRange, type ReportDateRange, type ReportPeriod } from "@/components/admin/ReportPeriodFilter";

export type ReportTab = "Sales Report" | "Guest Report" | "Staff Report";
type PeriodFilter = ReportPeriod;

interface ReportData {
  trend: { label: string; value: number }[];
  split: { label: string; value: number }[];
  rows: AdminTableRow[];
}

interface ReportResponse {
  success?: boolean;
  message?: string;
  report?: ReportData;
}

interface ReportTableConfig {
  columns: AdminTableColumn[];
  defaultSort: AdminTableSort;
}

const reportTabs: { title: ReportTab; description: string }[] = [
  { title: "Sales Report", description: "Verified revenue and booking volume for the selected period." },
  { title: "Guest Report", description: "Guest segments, visitor volume, and reservation activity." },
  { title: "Staff Report", description: "Staff and system actions recorded in the audit log." },
];

const reportTables: Record<ReportTab, ReportTableConfig> = {
  "Sales Report": {
    columns: [{ key: "label", label: "Period" }, { key: "revenue", label: "Revenue" }, { key: "bookings", label: "Bookings" }],
    defaultSort: { key: "revenue", direction: "desc" },
  },
  "Guest Report": {
    columns: [{ key: "segment", label: "Segment" }, { key: "count", label: "Count" }],
    defaultSort: { key: "count", direction: "desc" },
  },
  "Staff Report": {
    columns: [{ key: "staff", label: "Staff" }, { key: "actions", label: "Actions" }],
    defaultSort: { key: "actions", direction: "desc" },
  },
};

const emptyReport: ReportData = { trend: [], split: [], rows: [] };

/** Fetches one report from the authenticated server endpoint. */
const fetchReport = async (tab: ReportTab, period: PeriodFilter, range: ReportDateRange): Promise<ReportData> => {
  const params = new URLSearchParams({ tab, period });
  if (period === "Custom") { params.set("startDate", range.startDate); params.set("endDate", range.endDate); }
  const endpoint = tab === "Guest Report" ? "/api/admin/transactions/guest-report" : "/api/admin/reports";
  const response = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as ReportResponse | null;

  if (!response.ok || !payload?.success || !payload.report) {
    throw new Error(payload?.message ?? "Failed to load report.");
  }

  return payload.report;
};

/** Formats chart values without coupling report calculations to the UI. */
const formatChartValue = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

export default function ReportPanel({ tabs }: { tabs: readonly ReportTab[] }) {
  const [activeTab, setActiveTab] = useState<ReportTab>(tabs[0]);
  const [generation, setGeneration] = useState(0);
  const [period, setPeriod] = useState<PeriodFilter>("Daily");
  const [customRange, setCustomRange] = useState<ReportDateRange>(defaultReportDateRange);
  const [report, setReport] = useState<ReportData>(emptyReport);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadReport = async () => {
      setIsLoading(true);
      setFetchError(null);

      try {
        const nextReport = await fetchReport(activeTab, period, customRange);
        if (isMounted) setReport(nextReport);
      } catch (error) {
        if (!isMounted) return;
        setReport(emptyReport);
        setFetchError(error instanceof Error ? error.message : "Failed to load report.");
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void loadReport();
    return () => {
      isMounted = false;
    };
  }, [activeTab, period, customRange, generation]);

  const periodLabel = period === "Custom" ? `${customRange.startDate} through ${customRange.endDate}` : period;

  const splitTotal = useMemo(() => report.split.reduce((total, item) => total + item.value, 0), [report.split]);
  const maxTrendValue = Math.max(...report.trend.map((point) => point.value), 1);
  const pieStops = useMemo(() => {
    const colors = ["var(--color-secondary)", "var(--color-highlight)", "var(--color-primary)", "var(--color-accent)"];
    if (splitTotal <= 0) return "var(--color-neutral) 0% 100%";

    let offset = 0;
    return report.split.map((item, index) => {
      const end = offset + (item.value / splitTotal) * 100;
      const stop = `${colors[index % colors.length]} ${offset}% ${end}%`;
      offset = end;
      return stop;
    }).join(", ");
  }, [report.split, splitTotal]);

  const tableConfig = reportTables[activeTab];
  const tabDescription = reportTabs.find((tab) => tab.title === activeTab)?.description;

  const handleAction = (action: string) => {
    if (action === "Generate Report") { setGeneration((current) => current + 1); return; }
    if (action !== "Export CSV") return;
    const escapeCell = (value: string) => `"${(/^[=+@-]/.test(value) ? "'" : "") + value.replace(/"/g, '\"\"')}"`;
    const lines = [tableConfig.columns.map((column) => column.label), ...report.rows.map((row) => tableConfig.columns.map((column) => row[column.key] ?? ""))];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + lines.map((line) => line.map(escapeCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${activeTab.toLowerCase().replace(/ /g, "-")}-${period.toLowerCase()}.csv`;
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div>

      {fetchError ? <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">{fetchError}</p> : null}

      <section className="rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral/10 pb-4">
          <div className="flex flex-wrap gap-2">
            {reportTabs.filter((tab) => tabs.includes(tab.title)).map((tab) => (
              <button key={tab.title} type="button" onClick={() => setActiveTab(tab.title)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === tab.title ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"}`}>
                {tab.title}
              </button>
            ))}
          </div>

          <ReportPeriodFilter period={period} range={customRange} onPeriodChange={setPeriod} onRangeChange={setCustomRange} />
        </div>

        <p className="mb-4 text-sm text-neutral/70">{tabDescription}</p>

        <div className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-2xl border border-neutral/10 bg-base p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold text-neutral">{activeTab} Trend ({periodLabel})</h3>
            {isLoading ? <div className="mt-6 text-sm text-neutral/60">Loading report...</div> : report.trend.length === 0 ? <div className="mt-6 text-sm text-neutral/60">No records found for this period.</div> : (
              <div className="mt-3 grid grid-cols-7 gap-2">
                {report.trend.map((point) => (
                  <div key={point.label} className="flex flex-col items-center gap-2">
                    <div className="flex h-32 w-full items-end rounded-lg bg-white px-2 py-2">
                      <div className="w-full rounded-md bg-primary" style={{ height: `${(point.value / maxTrendValue) * 100}%` }} />
                    </div>
                    <div className="text-center"><p className="text-[10px] font-semibold text-neutral">{activeTab === "Sales Report" ? formatChartValue(point.value) : point.value.toLocaleString("en-PH")}</p><span className="text-xs text-neutral/70">{point.label}</span></div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-2xl border border-neutral/10 bg-base p-4">
            <h3 className="text-sm font-semibold text-neutral">Category Split</h3>
            <div className="mx-auto mt-3 h-36 w-36 rounded-full" style={{ background: `conic-gradient(${pieStops})` }} />
            {report.split.length === 0 ? <p className="mt-3 text-xs text-neutral/60">No records found.</p> : <ul className="mt-3 space-y-1 text-xs text-neutral/80">{report.split.map((item) => <li key={item.label}>{item.label}: {splitTotal > 0 ? Math.round((item.value / splitTotal) * 100) : 0}%</li>)}</ul>}
          </article>
        </div>

        <div className="mt-6">
          <AdminTablePreview title={`${activeTab} Snapshot (${periodLabel})`} columns={tableConfig.columns} rows={report.rows} defaultSort={tableConfig.defaultSort} actions={["Generate Report", "Export CSV"]} onAction={handleAction} isActionDisabled={() => isLoading || Boolean(fetchError)} />
        </div>
      </section>
    </div>
  );
}
