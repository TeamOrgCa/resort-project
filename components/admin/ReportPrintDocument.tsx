"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { ReportData, ReportRow, ReportTab } from "@/lib/reports/types";
import type { AdminTableColumn } from "@/components/admin/types";
import { reportConfig } from "@/lib/reports/config";
import type { ChartType } from "./ReportChart";
import PrintableReportChart, { type PrintChartData } from "./PrintableReportChart";

export type ReportPrintSnapshot = { tab: string; report: ReportData; columns: AdminTableColumn[]; rows: ReportRow[]; resort: string; trendTitle?: string; splitTitle?: string; chartFormat?: "money" | "count" | "percent"; charts?: { title: string; points: { label: string; value: number }[]; format: "money" | "count" | "percent"; type: ChartType }[] };
export default function ReportPrintDocument({ snapshot, onDone }: { snapshot: ReportPrintSnapshot; onDone: () => void }) {
  useEffect(() => {
    window.addEventListener("afterprint", onDone);
    const timer = window.setTimeout(() => { try { window.print(); } catch { onDone(); } }, 150);
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", onDone); };
  }, [onDone]);
  const { tab, report, columns, rows, resort } = snapshot;
  const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
  const format = snapshot.chartFormat ?? (tab === "Sales Report" ? "money" : "count");
  const charts: PrintChartData[] = snapshot.charts ?? [
    { title: snapshot.trendTitle ?? reportConfig[tab as ReportTab]?.trendTitle ?? "Trend", points: report.trend, format, type: "line" },
    { title: snapshot.splitTitle ?? reportConfig[tab as ReportTab]?.splitTitle ?? "Breakdown", points: report.split, format, type: "pie" },
  ];
  return createPortal(<div id="admin-report-print" className="hidden">
    <h1>{resort} — {tab}</h1>
    <p>{report.startDate} through {report.endDate} · Philippine time</p>
    <p>Generated: {new Date(report.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</p>
    <p>{report.note}</p>
    <dl>{report.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.format === "money" ? money.format(metric.value) : metric.value.toLocaleString("en-PH")} — {metric.help}</dd></div>)}</dl>
    <div className="admin-print-charts">{charts.map((chart, index) => <PrintableReportChart key={index} chart={chart} />)}</div>
    <p>Table: {rows.length} matching records. Summary covers the full date range.</p>
    <table><thead><tr>{columns.map(column => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key}>{row[column.key] ?? "—"}</td>)}</tr>)}</tbody></table>
  </div>, document.body);
}
