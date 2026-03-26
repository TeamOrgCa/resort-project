import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import { analyticsPanels, forecastColumns, forecastRows } from "@/components/admin/content";

export default function AdminAnalyticsPage() {
  return (
    <div>
      <AdminSectionHeader
        title="Business Analytics and Sales Forecasting"
        subtitle="Use AI-enhanced insights to support operational and managerial decision-making."
      />

      <section className="grid gap-4 md:grid-cols-3">
        {analyticsPanels.map((panel) => (
          <article key={panel.label} className="rounded-2xl border border-neutral/10 bg-white p-5">
            <h3 className="text-lg font-semibold text-neutral">{panel.label}</h3>
            <p className="mt-2 text-sm text-neutral/70">{panel.detail}</p>
            <p className="mt-4 text-xs text-neutral/60">Static placeholder for future charts and model output.</p>
          </article>
        ))}
      </section>

      <div className="mt-6">
        <AdminTablePreview
          title="Sales Forecasting Sample"
          columns={forecastColumns}
          rows={forecastRows}
          defaultSort={{ key: "projectedRevenue", direction: "desc" }}
          filters={[{ key: "confidence", label: "Confidence", options: ["High", "Medium", "Low"] }]}
          actions={["Run Forecast", "Export Summary"]}
          rowActions={["Inspect"]}
        />
      </div>
    </div>
  );
}
