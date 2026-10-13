export type ReportTab = "Sales Report" | "Guest Report" | "Staff Report";
export type ReportPeriod = "Daily" | "Weekly" | "Monthly" | "Custom";
export type ReportDateRange = { startDate: string; endDate: string };
export type ReportRow = { id: string; [key: string]: string };
export type ReportMetric = { label: string; value: number; format: "money" | "count"; help: string };
export type ReportData = {
  trend: { label: string; value: number }[];
  split: { label: string; value: number }[];
  rows: ReportRow[];
  metrics: ReportMetric[];
  startDate: string;
  endDate: string;
  generatedAt: string;
  note: string;
};
