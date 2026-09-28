"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow, AdminTableSort } from "@/components/admin/types";

type AnalyticsTab = "Booking Trend Analysis" | "Revenue Forecasting" | "Performance Signals" | "Guest Feedback Sentiment";
type PeriodFilter = "Daily" | "Weekly" | "Monthly";

type ChartData = { trend: { label: string; value: number }[]; split: { label: string; value: number }[]; rows: AdminTableRow[] };
type SentimentData = { overallSentiment: string; positivePercent: number; neutralPercent: number; negativePercent: number; themes: string[]; summary: string };

interface AnalyticsResponse {
  success?: boolean;
  message?: string;
  reports?: { booking: ChartData; revenue: ChartData; performance: ChartData };
}

interface ActionResponse {
  success?: boolean;
  message?: string;
  report?: ChartData;
  sentiment?: SentimentData;
}

interface AnalyticsTableConfig {
  columns: AdminTableColumn[];
  defaultSort: AdminTableSort;
}

const analyticsTabs: { title: AnalyticsTab; description: string }[] = [
  { title: "Booking Trend Analysis", description: "Live booking volume and channel mix from reservation records." },
  { title: "Revenue Forecasting", description: "A transparent projection based on verified payment history." },
  { title: "Performance Signals", description: "Operational indicators from payment queues and staff activity." },
  { title: "Guest Feedback Sentiment", description: "Gemini analysis of approved guest reviews and feedback themes." },
];

const tableConfigs: Record<AnalyticsTab, AnalyticsTableConfig> = {
  "Booking Trend Analysis": { columns: [{ key: "periodLabel", label: "Period" }, { key: "bookings", label: "Bookings" }, { key: "channel", label: "Channel" }], defaultSort: { key: "bookings", direction: "desc" } },
  "Revenue Forecasting": { columns: [{ key: "periodLabel", label: "Forecast Window" }, { key: "projectedBookings", label: "Projected Bookings" }, { key: "projectedRevenue", label: "Projected Revenue" }, { key: "confidence", label: "Confidence" }], defaultSort: { key: "projectedRevenue", direction: "desc" } },
  "Performance Signals": { columns: [{ key: "signal", label: "Signal" }, { key: "value", label: "Current Value" }, { key: "threshold", label: "Threshold" }, { key: "severity", label: "Severity" }], defaultSort: { key: "severity", direction: "desc" } },
  "Guest Feedback Sentiment": { columns: [{ key: "metric", label: "Metric" }, { key: "value", label: "Value" }], defaultSort: { key: "metric", direction: "asc" } },
};

const emptyChart: ChartData = { trend: [], split: [], rows: [] };
const emptySentiment: SentimentData = { overallSentiment: "Not analyzed", positivePercent: 0, neutralPercent: 0, negativePercent: 0, themes: [], summary: "Run sentiment analysis to evaluate approved guest feedback." };

/** Requests the live analytics snapshot for the selected time window. */
const fetchAnalytics = async (period: PeriodFilter) => {
  const response = await fetch(`/api/admin/analytics?period=${period}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => null)) as AnalyticsResponse | null;
  if (!response.ok || !payload?.success || !payload.reports) throw new Error(payload?.message ?? "Failed to load analytics.");
  return payload.reports;
};

/** Converts the visible table into a portable CSV download. */
const exportRows = (tab: AnalyticsTab, rows: AdminTableRow[], columns: AdminTableColumn[]) => {
  const escapeCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const csv = [columns.map((column) => escapeCell(column.label)).join(","), ...rows.map((row) => columns.map((column) => escapeCell(row[column.key] ?? "")).join(","))].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  link.download = `${tab.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-summary.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

/** Builds a print-friendly report so the browser can save the current view as a PDF. */
const exportPdf = (
  tab: AnalyticsTab,
  period: PeriodFilter,
  rows: AdminTableRow[],
  columns: AdminTableColumn[],
  sentiment: SentimentData
) => {
  const escapeHtml = (value: string) =>
    value.replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    })[character] ?? character);
  const title = escapeHtml(`${tab} - ${period}`);
  const tableHeader = columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const tableBody = rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column.key] ?? "-")}</td>`).join("")}</tr>`).join("");
  const sentimentSummary = tab === "Guest Feedback Sentiment"
    ? `<section><h2>Sentiment Summary</h2><p><strong>Overall:</strong> ${escapeHtml(sentiment.overallSentiment)}</p><p>${escapeHtml(sentiment.summary)}</p><p><strong>Themes:</strong> ${escapeHtml(sentiment.themes.join(", ") || "None identified")}</p></section>`
    : "";
  const printWindow = window.open("", "_blank", "width=900,height=700");

  if (!printWindow) {
    throw new Error("Allow pop-ups to export the report as a PDF.");
  }

  printWindow.document.write(`<!doctype html><html><head><title>${title}</title><style>
    body { font-family: Arial, sans-serif; color: #20242b; margin: 40px; }
    h1 { margin-bottom: 4px; } .meta { color: #606873; margin-bottom: 28px; }
    section { margin: 22px 0; } table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #d7dbe0; padding: 9px; text-align: left; }
    th { background: #f1f3f5; } @media print { body { margin: 18mm; } }
  </style></head><body><h1>${title}</h1><p class="meta">MarVille Resort Complex | Generated ${escapeHtml(new Date().toLocaleString("en-PH"))}</p>${sentimentSummary}<section><h2>Data Summary</h2><table><thead><tr>${tableHeader}</tr></thead><tbody>${tableBody || `<tr><td colspan="${columns.length}">No records found.</td></tr>`}</tbody></table></section></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.addEventListener("load", () => printWindow.print(), { once: true });
};

const formatValue = (value: number) => `₱${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;

export default function AdminAnalyticsPage() {
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("Booking Trend Analysis");
  const [period, setPeriod] = useState<PeriodFilter>("Daily");
  const [reports, setReports] = useState<{ booking: ChartData; revenue: ChartData; performance: ChartData }>({ booking: emptyChart, revenue: emptyChart, performance: emptyChart });
  const [sentiment, setSentiment] = useState<SentimentData>(emptySentiment);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionRunning, setIsActionRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setError(null);
    void fetchAnalytics(period)
      .then((nextReports) => { if (mounted) setReports(nextReports); })
      .catch((loadError: unknown) => { if (mounted) setError(loadError instanceof Error ? loadError.message : "Failed to load analytics."); })
      .finally(() => { if (mounted) setIsLoading(false); });
    return () => { mounted = false; };
  }, [period]);

  const chartData = activeTab === "Booking Trend Analysis" ? reports.booking : activeTab === "Revenue Forecasting" ? reports.revenue : activeTab === "Performance Signals" ? reports.performance : emptyChart;
  const sentimentRows: AdminTableRow[] = [
    { id: "sentiment-overall", metric: "Overall sentiment", value: sentiment.overallSentiment },
    { id: "sentiment-positive", metric: "Positive feedback", value: `${sentiment.positivePercent}%` },
    { id: "sentiment-neutral", metric: "Neutral feedback", value: `${sentiment.neutralPercent}%` },
    { id: "sentiment-negative", metric: "Negative feedback", value: `${sentiment.negativePercent}%` },
    { id: "sentiment-themes", metric: "Key themes", value: sentiment.themes.join("; ") || "None identified" },
  ];
  const visibleRows = activeTab === "Guest Feedback Sentiment" ? sentimentRows : chartData.rows;
  const tableConfig = tableConfigs[activeTab];
  const splitTotal = useMemo(() => chartData.split.reduce((total, item) => total + item.value, 0), [chartData.split]);
  const maxTrend = Math.max(...chartData.trend.map((point) => point.value), 1);
  const pieStops = useMemo(() => {
    if (!splitTotal) return "var(--color-neutral) 0% 100%";
    const colors = ["var(--color-accent)", "var(--color-highlight)", "var(--color-primary)", "var(--color-secondary)"];
    let offset = 0;
    return chartData.split.map((item, index) => { const end = offset + (item.value / splitTotal) * 100; const stop = `${colors[index % colors.length]} ${offset}% ${end}%`; offset = end; return stop; }).join(", ");
  }, [chartData.split, splitTotal]);

  const runAction = async (action: "forecast" | "sentiment") => {
    setIsActionRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/analytics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, period }) });
      const payload = (await response.json().catch(() => null)) as ActionResponse | null;
      if (!response.ok || !payload?.success) throw new Error(payload?.message ?? "Analytics action failed.");
      if (action === "forecast" && payload.report) setReports((current) => ({ ...current, revenue: payload.report as ChartData }));
      if (action === "sentiment" && payload.sentiment) setSentiment(payload.sentiment);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Analytics action failed.");
    } finally {
      setIsActionRunning(false);
    }
  };

  const handleAction = async (action: string) => {
    if (action === "Export Summary") {
      exportRows(activeTab, visibleRows, tableConfig.columns);
      return;
    }
    if (action === "Export PDF") {
      exportPdf(activeTab, period, visibleRows, tableConfig.columns, sentiment);
      return;
    }
    if (action === "Run Forecast") await runAction("forecast");
    if (action === "Analyze Feedback") await runAction("sentiment");
  };

  return (
    <div>
      <AdminSectionHeader title="Business Analytics and Sales Forecasting" subtitle="Use live resort activity and Gemini-assisted guest feedback analysis for operational decisions." />
      {error ? <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">{error}</p> : null}
      <section className="rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-neutral/10 pb-4">
          <div className="flex flex-wrap gap-2">{analyticsTabs.map((tab) => <button key={tab.title} type="button" onClick={() => setActiveTab(tab.title)} className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${activeTab === tab.title ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"}`}>{tab.title}</button>)}</div>
          <label className="flex items-center gap-2 text-sm text-neutral/70"><span>Period</span><select value={period} onChange={(event) => setPeriod(event.target.value as PeriodFilter)} className="rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral"><option value="Daily">Daily</option><option value="Weekly">Weekly</option><option value="Monthly">Monthly</option></select></label>
        </div>
        <p className="mb-4 text-sm text-neutral/70">{analyticsTabs.find((tab) => tab.title === activeTab)?.description}</p>

        {activeTab === "Guest Feedback Sentiment" ? <article className="rounded-2xl border border-neutral/10 bg-base p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm text-neutral/70">Overall sentiment</p><p className="mt-1 text-3xl font-bold text-primary">{sentiment.overallSentiment}</p></div><button type="button" onClick={() => void runAction("sentiment")} disabled={isActionRunning} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base disabled:opacity-50">{isActionRunning ? "Analyzing..." : "Analyze Feedback"}</button></div><p className="mt-4 text-sm text-neutral/80">{sentiment.summary}</p><div className="mt-4 flex flex-wrap gap-2">{sentiment.themes.map((theme) => <span key={theme} className="rounded-full bg-white px-3 py-1 text-xs text-neutral">{theme}</span>)}</div></article> : <div className="grid gap-4 lg:grid-cols-3"><article className="rounded-2xl border border-neutral/10 bg-base p-4 lg:col-span-2"><h3 className="text-sm font-semibold text-neutral">{activeTab} Trend ({period})</h3>{isLoading ? <div className="mt-6 text-sm text-neutral/60">Loading analytics...</div> : chartData.trend.length === 0 ? <div className="mt-6 text-sm text-neutral/60">No records found for this period.</div> : <div className="mt-3 grid grid-cols-7 gap-2">{chartData.trend.map((point) => <div key={point.label} className="flex flex-col items-center gap-2"><div className="flex h-32 w-full items-end rounded-lg bg-white px-2 py-2"><div className="w-full rounded-md bg-accent" style={{ height: `${(point.value / maxTrend) * 100}%` }} /></div><p className="text-center text-xs text-neutral/70">{formatValue(point.value)}<br />{point.label}</p></div>)}</div>}</article><article className="rounded-2xl border border-neutral/10 bg-base p-4"><h3 className="text-sm font-semibold text-neutral">Signal Split</h3><div className="mx-auto mt-3 h-36 w-36 rounded-full" style={{ background: `conic-gradient(${pieStops})` }} />{chartData.split.length === 0 ? <p className="mt-3 text-xs text-neutral/60">No records found.</p> : <ul className="mt-3 space-y-1 text-xs text-neutral/80">{chartData.split.map((item) => <li key={item.label}>{item.label}: {Math.round((item.value / splitTotal) * 100)}%</li>)}</ul>}</article></div>}

        <div className="mt-6"><AdminTablePreview title={`${activeTab} Snapshot (${period})`} columns={tableConfig.columns} rows={visibleRows} defaultSort={tableConfig.defaultSort} actions={activeTab === "Guest Feedback Sentiment" ? ["Analyze Feedback", "Export Summary", "Export PDF"] : ["Run Forecast", "Export Summary", "Export PDF"]} onAction={(action) => void handleAction(action)} isActionDisabled={(action) => action === "Run Forecast" && activeTab !== "Revenue Forecasting" || isActionRunning} rowActions={[]} /></div>
      </section>
    </div>
  );
}
