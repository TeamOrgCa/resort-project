"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import { AdminReportSkeleton } from "@/components/admin/AdminSkeletons";
import AdminTabs from "@/components/admin/AdminTabs";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import ReportChart, { type ChartType } from "@/components/admin/ReportChart";
import AnalyticsComparisonChart from "@/components/admin/AnalyticsComparisonChart";
import Link from "next/link";
import ReportPeriodFilter, { defaultReportDateRange } from "@/components/admin/ReportPeriodFilter";
import ReportPrintDocument, { type ReportPrintSnapshot } from "@/components/admin/ReportPrintDocument";
import { contentText, useSiteContent } from "@/components/content/SiteContent";
import { downloadReportCsv } from "@/lib/reports/export";
import type { AnalyticsReport, AnalyticsReports, SentimentData } from "@/lib/reports/analytics-types";
import type { ReportDateRange, ReportPeriod, ReportRow } from "@/lib/reports/types";
import type { AdminTableColumn, AdminTableSort } from "@/components/admin/types";
import GuestFeedbackPanel from "@/components/admin/GuestFeedbackPanel";

import { useAdminReadOnly } from "@/components/admin/AdminReadOnlyContext";

type Tab = "Bookings" | "Collection forecast" | "Operations" | "Guest feedback";
const tabs: { title: Tab; description: string }[] = [
  { title: "Bookings", description: "Compare booking demand, source performance and booking lead times to understand what is changing." },
  { title: "Collection forecast", description: "Plan using collection patterns, historical activity scenarios and a check of forecast accuracy against held-out days." },
  { title: "Operations", description: "Find payment verification bottlenecks through resolution rates, turnaround times and the age of the current queue." },
  { title: "Guest feedback", description: "Read guest reviews within these dates and archive feedback when your role permits it. Optional AI analysis uses up to 100 latest approved, active reviews." },
];
const tableConfigs: Record<Tab, { columns: AdminTableColumn[]; sort: AdminTableSort }> = {
  Bookings: { columns: [{ key: "source", label: "Booking source", sortType: "text" }, { key: "current", label: "Selected period", sortType: "number" }, { key: "previous", label: "Previous period", sortType: "number" }, { key: "change", label: "Growth", sortType: "text" }, { key: "confirmationRate", label: "Confirmed / completed", sortType: "number" }, { key: "cancellationRate", label: "Cancelled / no-show", sortType: "number" }], sort: { key: "current", direction: "desc" } },
  "Collection forecast": { columns: [{ key: "scenario", label: "Planning scenario", sortType: "text" }, { key: "projectedRevenue", label: "Estimated collections", sortType: "number" }, { key: "evidence", label: "Evidence", sortType: "text" }, { key: "method", label: "Calculation method", sortType: "text" }], sort: { key: "projectedRevenue", direction: "asc" } },
  Operations: { columns: [{ key: "age", label: "Time awaiting verification", sortType: "text" }, { key: "pending", label: "Pending payments", sortType: "number" }, { key: "amount", label: "Unverified amount", sortType: "number" }, { key: "meaning", label: "Suggested follow-up", sortType: "text" }], sort: { key: "pending", direction: "desc" } },
  "Guest feedback": { columns: [{ key: "metric", label: "Feedback measure", sortType: "text" }, { key: "value", label: "Result", sortType: "text" }], sort: { key: "metric", direction: "asc" } },
};
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
export default function AdminAnalyticsPage() {
  const readOnly = useAdminReadOnly();
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
    if (readOnly || !reports || analyzing) return;
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
  const splitFormat = activeTab === "Collection forecast" ? "money" : activeTab === "Guest feedback" ? "percent" : "count";
  const format = report?.trendFormat ?? splitFormat;
  const handleAction = (action: string, rows: ReportRow[]) => {
    if (!report || !rows.length || printSnapshot) return;
    setActionFailure(null);
    try {
      if (action === "Export CSV") downloadReportCsv(config.columns, rows, `analytics-${activeTab.toLowerCase().replaceAll(" ", "-")}-${report.startDate}-to-${report.endDate}.csv`);
      if (action === "Print report") setPrintSnapshot({ tab: `Analytics: ${activeTab}`, report: { ...report, note: [report.note, ...(report.insights ?? []).map(insight => `${insight.title}: ${insight.description}`)].join("\n\n") }, columns: config.columns, rows, resort: contentText(content, "resort.name"), charts: [
        ...(activeTab === "Guest feedback" ? [] : report.comparison ? [
          { title: `${report.trendTitle}: selected period`, points: report.comparison.points.map(point => ({ label: point.label, value: point.current })), format: report.comparison.format, type: "line" as const },
          { title: `Previous period: ${report.comparison.startDate} through ${report.comparison.endDate} (aligned positions)`, points: report.comparison.points.map((point, index) => ({ label: `Position ${index + 1}`, value: point.previous })), format: report.comparison.format, type: "line" as const },
        ] : [{ title: report.trendTitle, points: report.trend, format, type: trendType }]),
        { title: report.splitTitle, points: report.split, format: splitFormat, type: splitType },
        ...(report.forecastPoints ? [{ title: "Estimated daily collections", points: report.forecastPoints, format: "money" as const, type: "line" as const }] : []),
      ] });
    } catch { setActionFailure({ key, message: "Unable to prepare the document. Please try again." }); }
  };
  return <div>
    <AdminSectionHeader title="Resort Analytics" subtitle="Understand changes, plan collections and identify operational bottlenecks. All dates use Philippine time." />
    <section className="admin-panel" aria-label="Analytics viewer">
      <AdminTabs tabs={tabs.map(tab => tab.title)} value={activeTab} onChange={setActiveTab} label="Analytics sections" actions={<button type="button" onClick={refresh} disabled={loading || analyzing} className="admin-button-secondary">{loading ? "Loading..." : "Refresh analytics"}</button>} />
      <p className="mt-4 text-sm text-neutral/75">{tabs.find(tab => tab.title === activeTab)?.description}</p>
      <div className="mt-5 flex flex-wrap items-end gap-3 rounded-xl bg-base p-4">
        <ReportPeriodFilter key={period === "Custom" ? `${customRange.startDate}:${customRange.endDate}` : "preset"} period={period} range={customRange} onPeriodChange={value => { setPeriod(value); refresh(); }} onRangeChange={value => { setCustomRange(value); refresh(); }} />
        <button type="button" onClick={() => { setPeriod("Daily"); setCustomRange(defaultReportDateRange()); refresh(); }} className="rounded-xl border border-neutral/20 bg-white px-3 py-2 text-sm">Reset period</button>
      </div>
      <p className="mt-3 text-xs text-neutral/65">Dates update automatically when applied. Chart selectors change how the same values are displayed.</p>
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error} Use Refresh analytics to retry.</p>}
      {actionError && <p role="alert" className="mt-4 text-sm text-red-700">{actionError}</p>}
      {loading && activeTab !== "Guest feedback" && <AdminReportSkeleton label="Loading analytics..." />}
      {reports && <p className="mt-5 text-sm text-neutral/70">{reports.booking.startDate} through {reports.booking.endDate} | Updated {new Date(reports.booking.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>}
      {activeTab === "Guest feedback" && <GuestFeedbackPanel key={query} query={query} revision={generation} onChanged={refresh} />}
      {activeTab === "Guest feedback" && reports && !readOnly && <article className="mt-4 rounded-xl bg-base p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{sentiment?.overallSentiment ?? "Feedback has not been analyzed"}</h2><button type="button" disabled={analyzing} onClick={() => void analyzeFeedback()} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{analyzing ? "Analyzing..." : sentiment ? "Analyze again" : "Analyze feedback"}</button></div>
        {!sentiment && <p className="mt-3 text-sm text-neutral/70">Select dates, then analyze feedback to see review sentiment and common themes.</p>}
      </article>}
      {report && <>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">{report.metrics.map(metric => <article key={metric.label} className="min-w-0 rounded-xl border border-neutral/10 bg-base p-4"><h3 className="text-sm text-neutral/70">{metric.label}</h3><p className="mt-2 text-2xl font-bold">{metric.displayValue ?? (metric.format === "money" ? money.format(metric.value) : `${metric.value.toLocaleString("en-PH")}${metric.format === "percent" ? "%" : ""}`)}</p><p className="mt-2 text-xs leading-relaxed text-neutral/65">{metric.help}</p></article>)}</div>
        {report.insights && <section aria-label="Analytics findings" className="mt-5 grid gap-4 lg:grid-cols-3">{report.insights.map(insight => <article key={insight.title} className="min-w-0 rounded-xl border border-primary/15 bg-white p-4"><h3 className="font-semibold text-primary">{insight.title}</h3><p className="mt-2 text-sm leading-relaxed text-neutral/80">{insight.description}</p>{insight.href && <Link href={insight.href} className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-4">{insight.action ?? "View details"}</Link>}</article>)}</section>}
        {activeTab === "Guest feedback" && <p className="mt-4 rounded-xl border border-neutral/10 p-4 text-sm leading-relaxed text-neutral/75">{report.note}</p>}
        {report.comparison && <p className="mt-4 text-xs text-neutral/65">{new Date(report.comparison.observedThrough).getTime() <= Date.parse(`${report.startDate}T00:00:00+08:00`) ? "The selected dates have not started; no observed comparison is available." : <>Observations through {new Date(report.comparison.observedThrough).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}. Compared with {report.comparison.startDate} through {report.comparison.endDate} over the same elapsed duration.</>}</p>}
        <div className="mt-5 grid gap-5 xl:grid-cols-2">
          {activeTab !== "Guest feedback" && (report.comparison ? <AnalyticsComparisonChart title={report.trendTitle} comparison={report.comparison} /> : <ReportChart title={report.trendTitle} points={report.trend} format={format} chartType={trendType} onTypeChange={setTrendType} />)}
          <ReportChart title={report.splitTitle} points={report.split} format={splitFormat} chartType={splitType} onTypeChange={setSplitType} />
        </div>
        {report.forecastPoints && <div className="mt-5"><ReportChart title="Estimated daily collections" points={report.forecastPoints} format="money" chartType="line" interactive={false} description="Estimates for the dates below, separate from received collections. Historical activity scenarios appear in the planning table." /></div>}
        {activeTab !== "Guest feedback" && <details className="mt-5 rounded-xl border border-neutral/10 p-4 text-sm text-neutral/75"><summary className="cursor-pointer font-medium">How these insights are calculated</summary><p className="mt-3 leading-relaxed">{report.note}</p></details>}
        <p className="mb-3 mt-6 text-xs text-neutral/65">The summary covers the full period. Search affects table rows, CSV and printing; exports include every matching page. Use Print report to print or save a PDF.</p>
        <AdminTablePreview key={activeTab} title={report.tableTitle} columns={config.columns} rows={report.rows} defaultSort={config.sort} pageSize={25} showResetFilters allowReadOnlyExport actions={["Export CSV", "Print report"]} onAction={handleAction} isActionDisabled={(_action, rows) => !rows.length || Boolean(printSnapshot) || analyzing} />
      </>}
      {printSnapshot && <ReportPrintDocument snapshot={printSnapshot} onDone={stopPrinting} />}
    </section>
  </div>;
}
