"use client";

import { useId, useState } from "react";

export type ChartType = "line" | "bar" | "pie" | "progress";
const colors = ["#A9442B", "#2F6B3F", "#25918C", "#CA9414", "#7160A5", "#38729A", "#B85C7D", "#657043"];
const choices: Record<ChartType, string> = { line: "Line graph", bar: "Bar chart", pie: "Pie chart", progress: "Progress bars" };
export default function ReportChart({ title, points, format = "count", initialType = "line", description, chartType, onTypeChange, interactive = true }: {
  title: string; points: { label: string; value: number }[]; format?: "count" | "money" | "percent"; initialType?: ChartType; description?: string;
  chartType?: ChartType; onTypeChange?: (type: ChartType) => void; interactive?: boolean;
}) {
  const [selection, setSelection] = useState<ChartType>(initialType);
  const type = chartType ?? selection;
  const id = useId();
  const data = points.map(point => ({ ...point, value: Number.isFinite(point.value) ? Math.max(0, point.value) : 0 }));
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const rawMaximum = Math.max(1, ...data.map(point => point.value));
  const maximum = format === "count" ? Math.ceil(rawMaximum / 4) * 4 : format === "percent" ? 100 : rawMaximum;
  const value = (n: number) => format === "money" ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(n) : `${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}${format === "percent" ? "%" : ""}`;
  const width = Math.max(640, data.length * 50), height = 250, left = 90, right = width - 25, top = 20, bottom = 215;
  const x = (index: number) => data.length <= 1 ? (left + right) / 2 : left + index * (right - left) / (data.length - 1);
  const y = (n: number) => bottom - n / maximum * (bottom - top);
  return <article className="min-w-0 rounded-2xl border border-neutral/10 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <h3 id={`${id}-title`} className="font-semibold text-neutral">{title}</h3>
      {interactive && <label className="flex items-center gap-2 text-xs text-neutral/70">View
        <select aria-label={`${title} chart type`} value={type} onChange={event => { const next = event.target.value as ChartType; setSelection(next); onTypeChange?.(next); }} className="admin-field">
          {Object.entries(choices).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </label>}
    </div>
    {description && <p className="mt-2 text-xs leading-relaxed text-neutral/65">{description}</p>}
    {!total ? <p className="py-12 text-center text-sm text-neutral/60">No activity recorded during these dates.</p> : <>
      {type === "pie" ? <svg role="img" aria-labelledby={`${id}-title`} aria-label="Pie chart" viewBox="0 0 240 240" className="mx-auto my-4 h-56 w-56 max-w-full">
        {data.map((point, index) => {
          if (!point.value) return null;
          const start = -Math.PI / 2 + data.slice(0, index).reduce((sum, p) => sum + p.value, 0) / total * Math.PI * 2;
          const angle = start + point.value / total * Math.PI * 2;
          const fill = colors[index % colors.length];
          const label = `${point.label}: ${value(point.value)} (${(point.value / total * 100).toFixed(1)}%)`;
          return point.value === total ? <circle key={point.label} cx="120" cy="120" r="100" fill={fill}><title>{label}</title></circle> : <path key={point.label} fill={fill} stroke="white" strokeWidth="2" d={`M 120 120 L ${120 + 100 * Math.cos(start)} ${120 + 100 * Math.sin(start)} A 100 100 0 ${angle - start > Math.PI ? 1 : 0} 1 ${120 + 100 * Math.cos(angle)} ${120 + 100 * Math.sin(angle)} Z`}><title>{label}</title></path>;
        })}
      </svg> : type !== "progress" && <div className="mt-4 overflow-x-auto">
        <svg role="img" aria-labelledby={`${id}-title`} aria-label={choices[type]} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" style={{ minWidth: data.length > 12 ? width : 480 }}>
          {[0, 1, 2, 3, 4].map(tick => { const n = maximum * tick / 4; return <g key={tick}><line x1={left} x2={right} y1={y(n)} y2={y(n)} stroke="#E9E4DD" /><text x={left - 8} y={y(n) + 4} textAnchor="end" fontSize="12" fill="#65594F">{format === "money" ? new Intl.NumberFormat("en-PH", { notation: "compact", style: "currency", currency: "PHP" }).format(n) : value(n)}</text></g>; })}
          {type === "line" ? <><polyline points={data.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} fill="none" stroke={colors[0]} strokeWidth="3" />{data.map((point, index) => <circle key={point.label} cx={x(index)} cy={y(point.value)} r="5" fill={colors[0]}><title>{`${point.label}: ${value(point.value)}`}</title></circle>)}</> : data.map((point, index) => {
            const slot = (right - left) / data.length, barWidth = Math.min(50, slot * .65);
            return <rect key={point.label} x={left + slot * (index + .5) - barWidth / 2} y={y(point.value)} width={barWidth} height={bottom - y(point.value)} rx="3" fill={colors[index % colors.length]}><title>{`${point.label}: ${value(point.value)}`}</title></rect>;
          })}
          {data.map((point, index) => <text key={point.label} x={type === "bar" ? left + (right - left) / data.length * (index + .5) : x(index)} y="240" textAnchor="middle" fontSize="12" fill="#65594F">{index + 1}</text>)}
        </svg>
      </div>}
      <dl className="mt-4 space-y-3 text-sm" aria-label={`${title} values`}>{data.map((point, index) => <div key={point.label}>
        <div className="flex justify-between gap-3"><dt className="flex items-start gap-2 text-neutral/75"><span aria-hidden="true" className="mt-1 h-3 w-3 shrink-0 rounded-sm" style={{ background: type === "line" ? colors[0] : colors[index % colors.length] }} />{type !== "pie" && type !== "progress" && <span>{index + 1}.</span>}{point.label}</dt><dd className="shrink-0 text-right font-semibold text-neutral">{value(point.value)}{type === "pie" && <span className="ml-1 font-normal text-neutral/60">({(point.value / total * 100).toFixed(1)}%)</span>}</dd></div>
        {type === "progress" && <div aria-hidden="true" className="mt-1 h-3 rounded-full bg-base"><div className="h-full rounded-full" style={{ background: colors[index % colors.length], width: `${point.value / maximum * 100}%` }} /></div>}
      </div>)}</dl>
      {type === "pie" && <p className="mt-4 border-t border-neutral/10 pt-3 text-xs text-neutral/65">Total: {value(total)}. Each slice shows its share of this total.</p>}
    </>}
  </article>;
}
