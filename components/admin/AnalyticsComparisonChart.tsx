"use client";

import { useId } from "react";
import type { AnalyticsComparison } from "@/lib/reports/analytics-types";

/** Aligned elapsed-period comparisons; missing rates stay gaps, never zeroes. */
export default function AnalyticsComparisonChart({ title, comparison }: { title: string; comparison: AnalyticsComparison }) {
  const id = useId();
  const { points, format } = comparison;
  const value = (n: number | null) => n === null ? "No observation" : format === "money"
    ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n)
    : `${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}${format === "percent" ? "%" : ""}`;
  const rawMaximum = Math.max(1, ...points.flatMap(point => [point.current ?? 0, point.previous ?? 0]));
  const maximum = format === "percent" ? 100 : format === "count" ? Math.ceil(rawMaximum / 4) * 4 : rawMaximum;
  const width = Math.max(640, points.length * 48), left = 92, right = width - 24, top = 20, bottom = 215;
  const x = (i: number) => points.length <= 1 ? (left + right) / 2 : left + i * (right - left) / (points.length - 1);
  const y = (n: number) => bottom - n / maximum * (bottom - top);
  const series = [{ key: "current", label: "Selected period", color: "#A9442B" }, { key: "previous", label: "Previous period", color: "#38729A" }] as const;
  const hasObservation = points.some(point => point.current !== null || point.previous !== null);
  return <article className="min-w-0 rounded-2xl border border-neutral/10 bg-white p-4 shadow-sm sm:p-5">
    <h3 id={`${id}-title`} className="font-semibold text-neutral">{title}</h3>
    <p className="mt-2 text-xs leading-relaxed text-neutral/65">Previous: {comparison.startDate} through {comparison.endDate}. Aligned by elapsed position in the period. Gaps mean no observation; zero means observed zero.</p>
    <div className="mt-3 flex flex-wrap gap-4 text-xs">{series.map(item => <span key={item.key} className="flex items-center gap-2"><span aria-hidden="true" className="w-6 border-t-2" style={{ borderColor: item.color, borderStyle: item.key === "previous" ? "dashed" : "solid" }} />{item.label}</span>)}</div>
    {!hasObservation ? <p className="py-12 text-center text-sm text-neutral/60">No comparable observations during these dates.</p> : <>
      <div className="mt-4 overflow-x-auto">
        <svg role="img" aria-labelledby={`${id}-title`} aria-label="Selected and previous period comparison" viewBox={`0 0 ${width} 250`} className="h-auto w-full" style={{ minWidth: points.length > 12 ? width : 480 }}>
          {[0, 1, 2, 3, 4].map(tick => {
            const n = maximum * tick / 4;
            return <g key={tick}><line x1={left} x2={right} y1={y(n)} y2={y(n)} stroke="#E9E4DD" /><text x={left - 8} y={y(n) + 4} textAnchor="end" fontSize="12" fill="#65594F">{format === "money" ? new Intl.NumberFormat("en-PH", { notation: "compact", style: "currency", currency: "PHP" }).format(n) : value(n)}</text></g>;
          })}
          {series.map(item => <g key={item.key}>
            {points.map((point, index) => {
              const n = point[item.key], previous = points[index - 1]?.[item.key];
              if (n === null) return null;
              return <g key={point.label}>
                {typeof previous === "number" && <line x1={x(index - 1)} y1={y(previous)} x2={x(index)} y2={y(n)} stroke={item.color} strokeWidth="2.5" strokeDasharray={item.key === "previous" ? "6 4" : undefined} />}
                <circle cx={x(index)} cy={y(n)} r={item.key === "previous" ? 5 : 3} fill={item.key === "previous" ? "white" : item.color} stroke={item.color} strokeWidth="2"><title>{`${point.label}, ${item.label}: ${value(n)}`}</title></circle>
              </g>;
            })}
          </g>)}
          {points.map((point, index) => <text key={point.label} x={x(index)} y="240" textAnchor="middle" fontSize="12" fill="#65594F">{index + 1}</text>)}
        </svg>
      </div>
      <details className="mt-4 text-xs text-neutral/75"><summary className="cursor-pointer font-medium">View comparison values</summary>
        <div className="mt-3 max-h-64 overflow-auto"><table className="w-full text-left"><caption className="sr-only">{title} values</caption><thead><tr><th className="p-2">Selected dates / position</th><th className="p-2">Selected</th><th className="p-2">Previous</th></tr></thead><tbody>{points.map((point, i) => <tr key={point.label}><th scope="row" className="p-2 font-normal">{i + 1}. {point.label}</th><td className="p-2">{value(point.current)}</td><td className="p-2">{value(point.previous)}</td></tr>)}</tbody></table></div>
      </details>
    </>}
  </article>;
}
