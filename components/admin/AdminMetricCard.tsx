import type { AdminMetric } from "@/components/admin/types";

interface AdminMetricCardProps {
  metric: AdminMetric;
}

export default function AdminMetricCard({ metric }: AdminMetricCardProps) {
  return (
    <article className="rounded-2xl border border-neutral/10 bg-white p-5">
      <p className="text-sm text-neutral/70">{metric.label}</p>
      <p className="mt-2 text-2xl font-bold text-neutral">{metric.value}</p>
      <p className="mt-1 text-xs text-secondary">{metric.trend}</p>
    </article>
  );
}
