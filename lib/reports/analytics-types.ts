import type { ReportData } from "./types";

export type AnalyticsInsight = { title: string; description: string; href?: string; action?: string };
export type AnalyticsComparison = {
  startDate: string; endDate: string; observedThrough: string;
  format: "count" | "money" | "percent";
  points: { label: string; current: number | null; previous: number | null }[];
};
export type AnalyticsReport = ReportData & {
  trendTitle: string; splitTitle: string; tableTitle: string;
  insights?: AnalyticsInsight[]; comparison?: AnalyticsComparison;
  forecastPoints?: { label: string; value: number }[];
  trendFormat?: "count" | "money" | "percent";
};
export type AnalyticsReports = { booking: AnalyticsReport; revenue: AnalyticsReport; performance: AnalyticsReport };
export type SentimentData = {
  overallSentiment: string; positivePercent: number; neutralPercent: number; negativePercent: number;
  themes: string[]; summary: string; sampleSize: number; startDate: string; endDate: string; generatedAt: string;
};
