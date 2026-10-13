import type { ReportData } from "./types";

export type AnalyticsReport = ReportData & { trendTitle: string; splitTitle: string; tableTitle: string };
export type AnalyticsReports = { booking: AnalyticsReport; revenue: AnalyticsReport; performance: AnalyticsReport };
export type SentimentData = {
  overallSentiment: string; positivePercent: number; neutralPercent: number; negativePercent: number;
  themes: string[]; summary: string; sampleSize: number; startDate: string; endDate: string; generatedAt: string;
};
