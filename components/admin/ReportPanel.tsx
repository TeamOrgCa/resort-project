"use client";

import { useCallback, useEffect, useState } from "react";
import ReportChart, { type ChartType } from "@/components/admin/ReportChart";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import ReportPeriodFilter, { defaultReportDateRange } from "@/components/admin/ReportPeriodFilter";
import ReportPrintDocument, { type ReportPrintSnapshot } from "@/components/admin/ReportPrintDocument";
import { contentText, useSiteContent } from "@/components/content/SiteContent";
import { downloadReportCsv } from "@/lib/reports/export";
import { reportConfig } from "@/lib/reports/config";
import type { ReportData, ReportDateRange, ReportPeriod, ReportRow, ReportTab } from "@/lib/reports/types";
export type { ReportTab } from "@/lib/reports/types";

const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });

export default function ReportPanel({ tabs }: { tabs: readonly ReportTab[] }) {
  const [activeTab, setActiveTab] = useState<ReportTab>(tabs[0]);
  const [generation, setGeneration] = useState(0);
  const [period, setPeriod] = useState<ReportPeriod>("Daily");
  const [customRange, setCustomRange] = useState<ReportDateRange>(defaultReportDateRange);
  const [result, setResult] = useState<{ key: string; data: ReportData } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printSnapshot, setPrintSnapshot] = useState<ReportPrintSnapshot | null>(null);
  const [trendType, setTrendType] = useState<ChartType>("line");
  const [splitType, setSplitType] = useState<ChartType>("pie");
  const content = useSiteContent();
  const params = new URLSearchParams({ tab: activeTab, period });
  if (period === "Custom") { params.set("startDate", customRange.startDate); params.set("endDate", customRange.endDate); }
  const query = params.toString();
  const key = `${query}:${generation}`;
  // A changed filter immediately hides the previous report and disables stale exports.
  const report = result?.key === key ? result.data : null;
  const fetchError = failure?.key === key ? failure.message : null;
  const isLoading = !report && !fetchError;
  const config = reportConfig[activeTab];

  useEffect(() => {
    const controller = new AbortController();
    const endpoint = activeTab === "Guest Report" ? "/api/admin/transactions/guest-report" : "/api/admin/reports";
    const load = async () => {
      try {
        const response = await fetch(`${endpoint}?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as { success?: boolean; message?: string; report?: ReportData } | null;
        if (!response.ok || !payload?.success || !payload.report) throw new Error(payload?.message ?? "Unable to load the report. Please refresh to try again.");
        if (!controller.signal.aborted) setResult({ key, data: payload.report });
      } catch (cause) {
        if (!controller.signal.aborted) setFailure({ key, message: cause instanceof Error ? cause.message : "Unable to load report." });
      }
    };
    void load();
    return () => controller.abort();
  }, [activeTab, key, query]);

  const stopPrinting = useCallback(() => setPrintSnapshot(null), []);
  const refresh = () => { setActionError(null); setGeneration(value => value + 1); };
  const handleAction = (action: string, rows: ReportRow[]) => {
    if (!report || !rows.length || printSnapshot) return;
    setActionError(null);
    try {
      if (action === "Export CSV") downloadReportCsv(config.columns, rows, `${activeTab.toLowerCase().replaceAll(" ", "-")}-${report.startDate}-to-${report.endDate}.csv`);
      if (action === "Print report") setPrintSnapshot({ tab: activeTab, report, columns: config.columns, rows, resort: contentText(content, "resort.name"), charts: [
        { title: config.trendTitle, points: report.trend, type: trendType, format: activeTab === "Sales Report" ? "money" : "count" },
        { title: config.splitTitle, points: report.split, type: splitType, format: activeTab === "Sales Report" ? "money" : "count" },
      ] });
    } catch { setActionError("Unable to prepare this document. Please try again."); }
  };

  return <section className="rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6" aria-label="Report viewer">
    <div className="flex flex-wrap items-center justify-between gap-3">
      {tabs.length > 1 ? <div className="flex flex-wrap gap-2" aria-label="Report type">
        {tabs.map(tab => <button key={tab} type="button" aria-pressed={activeTab === tab} onClick={() => { setActiveTab(tab); setActionError(null); }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === tab ? "bg-primary text-white" : "bg-base text-neutral hover:bg-neutral/10"}`}>{tab}</button>)}
      </div> : <h2 className="text-xl font-semibold text-neutral">{activeTab}</h2>}
      <button type="button" disabled={isLoading} onClick={refresh} className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-semibold text-neutral hover:bg-base disabled:opacity-50">{isLoading ? "Loading…" : "Refresh report"}</button>
    </div>
    <p className="mt-4 text-sm leading-relaxed text-neutral/75">{config.description}</p>
    <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl bg-base p-4">
      <ReportPeriodFilter key={period === "Custom" ? `${customRange.startDate}:${customRange.endDate}` : "preset"} period={period} range={customRange} onPeriodChange={setPeriod} onRangeChange={setCustomRange} />
      <button type="button" onClick={() => { setPeriod("Daily"); setCustomRange(defaultReportDateRange()); refresh(); }} className="rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral hover:bg-neutral/5">Reset period</button>
    </div>
    <p className="mt-3 text-xs text-neutral/65">Reports update automatically when dates are applied. All dates and times use Philippine time.</p>

    {fetchError && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{fetchError} Use Refresh report to retry.</div>}
    {actionError && <p role="alert" className="mt-4 text-sm text-red-700">{actionError}</p>}
    {isLoading && <p role="status" className="py-12 text-center text-sm text-neutral/65">Loading {activeTab.toLowerCase()}…</p>}

    {report && <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 text-sm text-neutral/70">
        <p className="font-semibold text-neutral">{report.startDate} through {report.endDate}</p>
        <p>Updated {new Date(report.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>
      </div>
      <div className={`mt-4 grid gap-3 sm:grid-cols-2 ${report.metrics.length === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
        {report.metrics.map(metric => <article key={metric.label} className="rounded-xl border border-neutral/10 bg-base p-4">
          <h3 className="text-sm text-neutral/70">{metric.label}</h3>
          <p className="mt-2 text-2xl font-bold text-neutral">{metric.format === "money" ? money.format(metric.value) : metric.value.toLocaleString("en-PH")}</p>
          <p className="mt-2 text-xs leading-relaxed text-neutral/65">{metric.help}</p>
        </article>)}
      </div>
      <p className="mt-4 rounded-xl border border-neutral/10 p-4 text-sm leading-relaxed text-neutral/75">{report.note}</p>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <ReportChart title={config.trendTitle} points={report.trend} format={activeTab === "Sales Report" ? "money" : "count"} chartType={trendType} onTypeChange={setTrendType} description="Read the dates and exact values below the graph. Change View to compare chart styles." />
        <ReportChart title={config.splitTitle} points={report.split} format={activeTab === "Sales Report" ? "money" : "count"} chartType={splitType} onTypeChange={setSplitType} />
      </div>
      <p className="mb-3 mt-6 text-xs leading-relaxed text-neutral/65">The summary covers the full date range. Search and table filters apply to the table, CSV and printed report. Exports include every matching page.</p>
      <AdminTablePreview key={activeTab} title={config.tableTitle} columns={config.columns} rows={report.rows} defaultSort={config.sort} filters={config.filters} searchPlaceholder={config.search} pageSize={25} showResetFilters actions={["Export CSV", "Print report"]} onAction={handleAction} isActionDisabled={(_action, rows) => !rows.length || Boolean(printSnapshot)} />
    </>}
    {printSnapshot && <ReportPrintDocument snapshot={printSnapshot} onDone={stopPrinting} />}
  </section>;
}
