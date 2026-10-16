"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import ReportChart, { type ChartType } from "@/components/admin/ReportChart";
import ReportPeriodFilter, { defaultReportDateRange } from "@/components/admin/ReportPeriodFilter";
import ReportPrintDocument, { type ReportPrintSnapshot } from "@/components/admin/ReportPrintDocument";
import { contentText, useSiteContent } from "@/components/content/SiteContent";
import { downloadReportCsv } from "@/lib/reports/export";
import type { AnalyticsReport, AnalyticsReports, SentimentData } from "@/lib/reports/analytics-types";
import type { ReportDateRange, ReportPeriod, ReportRow } from "@/lib/reports/types";
import type { AdminTableColumn, AdminTableSort } from "@/components/admin/types";
import GuestFeedbackPanel from "@/components/admin/GuestFeedbackPanel";

type Tab = "Bookings" | "Collection forecast" | "Operations" | "Guest feedback";
const tabs: { title: Tab; description: string }[] = [
  { title: "Bookings", description: "See how many reservations were created and where those bookings came from." },
  { title: "Collection forecast", description: "Compare actual verified collections with a simple estimate based on your historical daily average." },
  { title: "Operations", description: "Check payment submissions awaiting review and recorded system activity within these dates." },
  { title: "Guest feedback", description: "Read guest reviews within these dates and archive feedback when your role permits it. Optional AI analysis uses up to 100 latest approved, active reviews." },
];
const tableConfigs: Record<Tab, { columns: AdminTableColumn[]; sort: AdminTableSort }> = {
  Bookings: { columns: [{ key: "periodLabel", label: "Booking dates (PH)", sortType: "date", sortKey: "periodStart" }, { key: "bookings", label: "Reservations created", sortType: "number" }], sort: { key: "periodLabel", direction: "asc" } },
  "Collection forecast": { columns: [{ key: "periodLabel", label: "Forecast dates (PH)", sortType: "text" }, { key: "projectedBookings", label: "Estimated new reservations", sortType: "number" }, { key: "projectedRevenue", label: "Estimated collections", sortType: "number" }, { key: "evidence", label: "Source history", sortType: "text" }, { key: "method", label: "Calculation method", sortType: "text" }], sort: { key: "projectedRevenue", direction: "desc" } },
  Operations: { columns: [{ key: "signal", label: "Task", sortType: "text" }, { key: "value", label: "Count", sortType: "number" }, { key: "meaning", label: "What this means / next step", sortType: "text" }], sort: { key: "signal", direction: "asc" } },
  "Guest feedback": { columns: [{ key: "metric", label: "Feedback measure", sortType: "text" }, { key: "value", label: "Result", sortType: "text" }], sort: { key: "metric", direction: "asc" } },
};
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
export default function AdminAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("Bookings");
  const [period, setPeriod] = useState<ReportPeriod>("Daily");
  const [customRange, setCustomRange] = useState<ReportDateRange>(defaultReportDateRange);
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<{ key: string; reports: AnalyticsReports } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [feedback, setFeedback] = useState<{ key: string; data: SentimentData } | null>(null);
  const [actionFailure, setActionFailure] = useState<{ key: string; message: string } | null>(null);
  const [running, setRunning] = useState<{ key: string; controller: AbortController } | null>(null);
  const [printSnapshot, setPrintSnapshot] = useState<ReportPrintSnapshot | null>(null);
  const [trendType, setTrendType] = useState<ChartType>("line");
  const [splitType, setSplitType] = useState<ChartType>("pie");
  const feedbackController = useRef<AbortController | null>(null);
  const content = useSiteContent();
  const params = new URLSearchParams({ period });
  if (period === "Custom") { params.set("startDate", customRange.startDate); params.set("endDate", customRange.endDate); }
  const query = params.toString(), key = `${query}:${generation}`;
  const reports = result?.key === key ? result.reports : null;
  const error = failure?.key === key ? failure.message : null;
  const actionError = actionFailure?.key === key ? actionFailure.message : null;
  const sentiment = feedback?.key === key ? feedback.data : null;
  const loading = !reports && !error;
  const analyzing = running?.key === key && !running.controller.signal.aborted;

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(`/api/admin/analytics?${query}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json().catch(() => null) as { success?: boolean; reports?: AnalyticsReports; message?: string } | null;
        if (!response.ok || !payload?.success || !payload.reports) throw new Error(payload?.message ?? "Unable to load analytics. Refresh to try again.");
        if (!controller.signal.aborted) setResult({ key, reports: payload.reports });
      } catch (cause) { if (!controller.signal.aborted) setFailure({ key, message: cause instanceof Error ? cause.message : "Unable to load analytics." }); }
    };
    void load();
    return () => { controller.abort(); feedbackController.current?.abort(); };
  }, [key, query]);
  const stopPrinting = useCallback(() => setPrintSnapshot(null), []);
  const refresh = () => setGeneration(value => value + 1);
  const analyzeFeedback = async () => {
    if (!reports || analyzing) return;
    const controller = new AbortController(); feedbackController.current = controller;
    setRunning({ key, controller }); setActionFailure(null);
    try {
      const response = await fetch("/api/admin/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action: "sentiment", period, ...(period === "Custom" ? customRange : {}) }) });
      const payload = await response.json().catch(() => null) as { success?: boolean; sentiment?: SentimentData; message?: string } | null;
      if (!response.ok || !payload?.success || !payload.sentiment) throw new Error(payload?.message ?? "Unable to analyze feedback. Please try again.");
      if (!controller.signal.aborted) setFeedback({ key, data: payload.sentiment });
    } catch (cause) { if (!controller.signal.aborted) setActionFailure({ key, message: cause instanceof Error ? cause.message : "Unable to analyze feedback." }); }
    finally { setRunning(current => current?.controller === controller ? null : current); }
  };
  let report: AnalyticsReport | null = !reports ? null : activeTab === "Bookings" ? reports.booking : activeTab === "Collection forecast" ? reports.revenue : activeTab === "Operations" ? reports.performance : null;
  if (activeTab === "Guest feedback" && sentiment) report = {
    ...sentiment, trend: [], split: [{ label: "Positive", value: sentiment.positivePercent }, { label: "Neutral", value: sentiment.neutralPercent }, { label: "Negative", value: sentiment.negativePercent }],
    trendTitle: "Feedback analysis", splitTitle: "Share of analyzed feedback", tableTitle: "Feedback results",
    metrics: [{ label: "Reviews analyzed", value: sentiment.sampleSize, format: "count", help: "Up to 100 latest approved, non-archived reviews in the selected dates." }],
    note: `${sentiment.summary} Themes: ${sentiment.themes.join(", ") || "None identified"}. AI-generated summary of ${sentiment.sampleSize} reviews; this may not represent all guests.`,
    rows: [{ id: "overall", metric: "Overall feedback", value: sentiment.overallSentiment }, { id: "positive", metric: "Positive", value: `${sentiment.positivePercent}%` }, { id: "neutral", metric: "Neutral", value: `${sentiment.neutralPercent}%` }, { id: "negative", metric: "Negative", value: `${sentiment.negativePercent}%` }, { id: "themes", metric: "Themes", value: sentiment.themes.join("; ") || "None identified" }],
  };
  const config = tableConfigs[activeTab];
  const format: "money" | "count" | "percent" = activeTab === "Collection forecast" ? "money" : activeTab === "Guest feedback" ? "percent" : "count";
  const handleAction = (action: string, rows: ReportRow[]) => {
    if (!report || !rows.length || printSnapshot) return;
    setActionFailure(null);
    try {
      if (action === "Export CSV") downloadReportCsv(config.columns, rows, `analytics-${activeTab.toLowerCase().replaceAll(" ", "-")}-${report.startDate}-to-${report.endDate}.csv`);
      if (action === "Print report") setPrintSnapshot({ tab: `Analytics: ${activeTab}`, report, columns: config.columns, rows, resort: contentText(content, "resort.name"), charts: [
        ...(activeTab === "Guest feedback" ? [] : [{ title: report.trendTitle, points: report.trend, format, type: trendType }]),
        { title: report.splitTitle, points: report.split, format, type: splitType },
      ] });
    } catch { setActionFailure({ key, message: "Unable to prepare the document. Please try again." }); }
  };
  return <div>
    <AdminSectionHeader title="Resort Analytics" subtitle="Understand bookings, collections and tasks to follow up. All dates use Philippine time." />
    <section className="rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6" aria-label="Analytics viewer">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">{tabs.map(tab => <button key={tab.title} type="button" aria-pressed={activeTab === tab.title} onClick={() => setActiveTab(tab.title)} className={`rounded-lg px-4 py-2 text-sm font-semibold ${activeTab === tab.title ? "bg-primary text-white" : "bg-base text-neutral hover:bg-neutral/10"}`}>{tab.title}</button>)}</div>
        <button type="button" onClick={refresh} disabled={loading || analyzing} className="rounded-lg border border-neutral/20 px-4 py-2 text-sm font-semibold disabled:opacity-50">{loading ? "Loading..." : "Refresh analytics"}</button>
      </div>
      <p className="mt-4 text-sm text-neutral/75">{tabs.find(tab => tab.title === activeTab)?.description}</p>
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl bg-base p-4">
        <ReportPeriodFilter key={period === "Custom" ? `${customRange.startDate}:${customRange.endDate}` : "preset"} period={period} range={customRange} onPeriodChange={value => { setPeriod(value); refresh(); }} onRangeChange={value => { setCustomRange(value); refresh(); }} />
        <button type="button" onClick={() => { setPeriod("Daily"); setCustomRange(defaultReportDateRange()); refresh(); }} className="rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm">Reset period</button>
      </div>
      <p className="mt-3 text-xs text-neutral/65">Dates update automatically when applied. Chart selectors change how the same values are displayed.</p>
      {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-4 text-sm text-red-800">{error} Use Refresh analytics to retry.</p>}
      {actionError && <p role="alert" className="mt-4 text-sm text-red-700">{actionError}</p>}
      {loading && <p role="status" className="py-12 text-center text-sm text-neutral/65">Loading analytics...</p>}
      {reports && <p className="mt-5 text-sm text-neutral/70">{reports.booking.startDate} through {reports.booking.endDate} | Updated {new Date(reports.booking.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>}
      {activeTab === "Guest feedback" && <GuestFeedbackPanel key={query} query={query} revision={generation} onChanged={refresh} />}
      {activeTab === "Guest feedback" && reports && <article className="mt-4 rounded-xl bg-base p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{sentiment?.overallSentiment ?? "Feedback has not been analyzed"}</h2><button type="button" disabled={analyzing} onClick={() => void analyzeFeedback()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{analyzing ? "Analyzing..." : sentiment ? "Analyze again" : "Analyze feedback"}</button></div>
        {!sentiment && <p className="mt-3 text-sm text-neutral/70">Select dates, then analyze feedback to see review sentiment and common themes.</p>}
      </article>}
      {report && <>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">{report.metrics.map(metric => <article key={metric.label} className="rounded-xl border border-neutral/10 bg-base p-4"><h3 className="text-sm text-neutral/70">{metric.label}</h3><p className="mt-2 text-2xl font-bold">{metric.format === "money" ? money.format(metric.value) : metric.value.toLocaleString("en-PH")}</p><p className="mt-2 text-xs leading-relaxed text-neutral/65">{metric.help}</p></article>)}</div>
        <p className="mt-4 rounded-xl border border-neutral/10 p-4 text-sm leading-relaxed text-neutral/75">{report.note}</p>
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {activeTab !== "Guest feedback" && <ReportChart title={report.trendTitle} points={report.trend} format={format} chartType={trendType} onTypeChange={setTrendType} />}
          <ReportChart title={report.splitTitle} points={report.split} format={format} chartType={splitType} onTypeChange={setSplitType} />
        </div>
        <p className="mb-3 mt-6 text-xs text-neutral/65">The summary covers the full period. Search affects table rows, CSV and printing; exports include every matching page. Use Print report to print or save a PDF.</p>
        <AdminTablePreview key={activeTab} title={report.tableTitle} columns={config.columns} rows={report.rows} defaultSort={config.sort} pageSize={25} showResetFilters actions={["Export CSV", "Print report"]} onAction={handleAction} isActionDisabled={(_action, rows) => !rows.length || Boolean(printSnapshot) || analyzing} />
      </>}
      {printSnapshot && <ReportPrintDocument snapshot={printSnapshot} onDone={stopPrinting} />}
    </section>
  </div>;
}
