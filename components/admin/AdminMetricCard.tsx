import type { AdminMetric } from "@/components/admin/types";

interface AdminMetricCardProps {
  metric: AdminMetric;
}

export default function AdminMetricCard({ metric }: AdminMetricCardProps) {
  return (
    <article className="min-w-0 rounded-2xl border border-neutral/10 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-neutral/65">{metric.label}</p>
      <p className="mt-2 break-words text-2xl font-semibold tracking-tight text-neutral">{metric.value}</p>
      <p className="mt-2 text-xs leading-relaxed text-neutral/60">{metric.trend}</p>
    </article>
  );
}
