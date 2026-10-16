import { useId } from "react";
import type { ChartType } from "./ReportChart";

export type PrintChartData = { title: string; points: { label: string; value: number }[]; format: "money" | "count" | "percent"; type: ChartType };
const colors = ["#A9442B", "#2F6B3F", "#167B76", "#906900", "#7160A5", "#38729A", "#9D3A60", "#657043"];
const titles = { line: "Line graph", bar: "Bar chart", pie: "Pie chart" };

/** Fixed-size SVG plots print without external images or background graphics.
 * Split long series so axes and values stay legible on A4 instead of shrinking. */
export default function PrintableReportChart({ chart }: { chart: PrintChartData }) {
  const parts = chart.type === "pie" ? [chart.points] : Array.from({ length: Math.max(1, Math.ceil(chart.points.length / 12)) }, (_, i) => chart.points.slice(i * 12, i * 12 + 12));
  return <>{parts.map((points, index) => <PrintChartFigure key={index} chart={{ ...chart, points,
    title: parts.length > 1 ? `${chart.title} (${index + 1}/${parts.length})` : chart.title }} />)}</>;
}

function PrintChartFigure({ chart }: { chart: PrintChartData }) {
  const id = useId();
  const type = chart.type === "progress" ? "bar" : chart.type;
  const data = chart.points.map(point => ({ ...point, value: Number.isFinite(point.value) ? Math.max(0, point.value) : 0 }));
  const value = (n: number) => chart.format === "money" ? new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(n)
    : `${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}${chart.format === "percent" ? "%" : ""}`;
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const raw = Math.max(1, ...data.map(point => point.value));
  const maximum = chart.format === "count" ? Math.ceil(raw / 4) * 4 : chart.format === "percent" ? Math.max(100, raw) : raw;
  const left = 95, right = 735, top = 30, bottom = 235;
  const x = (index: number) => data.length < 2 ? (left + right) / 2 : left + index * (right - left) / (data.length - 1);
  const y = (amount: number) => bottom - amount / maximum * (bottom - top);
  const shortLabel = (label: string) => { const short = label.replace(/,?\s*20\d{2}/g, ""); return short.length > 16 ? `${short.slice(0, 15)}…` : short; };
  return <article className="admin-print-chart" aria-labelledby={id}>
    <h2 id={id}>{chart.title}</h2>
    {type === "pie" && total > 0 ? <svg role="img" aria-label={titles[type]} viewBox="0 0 260 240" className="admin-print-pie">
      {data.map((point, index) => {
        if (!point.value) return null;
        const start = -Math.PI / 2 + data.slice(0, index).reduce((sum, p) => sum + p.value, 0) / total * Math.PI * 2;
        const angle = point.value / total * Math.PI * 2, end = start + angle, mid = start + angle / 2;
        return <g key={index}>{point.value === total ? <circle cx="130" cy="120" r="100" fill={colors[index % colors.length]} />
          : <path fill={colors[index % colors.length]} stroke="white" strokeWidth="2" d={`M130 120L${130 + 100 * Math.cos(start)} ${120 + 100 * Math.sin(start)}A100 100 0 ${angle > Math.PI ? 1 : 0} 1 ${130 + 100 * Math.cos(end)} ${120 + 100 * Math.sin(end)}Z`} />}
          <title>{point.label}: {value(point.value)}</title>
          {point.value / total >= .08 && <text x={130 + 65 * Math.cos(mid)} y={125 + 65 * Math.sin(mid)} textAnchor="middle" fontSize="15" fontWeight="bold" fill="white">{(point.value / total * 100).toFixed(0)}%</text>}
        </g>;
      })}
    </svg> : <svg role="img" aria-label={type === "pie" ? "Pie chart" : titles[type]} viewBox="0 0 760 295" className="admin-print-plot">
      {[0, 1, 2, 3, 4].map(tick => { const n = maximum * tick / 4; return <g key={tick}><line x1={left} x2={right} y1={y(n)} y2={y(n)} stroke="#d1d5db" /><text x={left - 10} y={y(n) + 4} textAnchor="end" fontSize="13" fill="#374151">{chart.format === "money" ? new Intl.NumberFormat("en-PH", { notation: "compact", style: "currency", currency: "PHP" }).format(n) : value(n)}</text></g>; })}
      <line x1={left} x2={left} y1={top} y2={bottom} stroke="#374151" />
      {type === "line" && <polyline fill="none" stroke={colors[0]} strokeWidth="3" points={data.map((point, index) => `${x(index)},${y(point.value)}`).join(" ")} />}
      {data.map((point, index) => {
        const slot = (right - left) / Math.max(data.length, 1), center = type === "line" ? x(index) : left + slot * (index + .5), width = Math.min(44, slot * .65);
        return <g key={index}>
          {type === "line" ? <circle cx={center} cy={y(point.value)} r="4" fill={colors[0]} /> : <rect x={center - width / 2} y={y(point.value)} width={width} height={Math.max(0, bottom - y(point.value))} fill={colors[index % colors.length]} />}
          <title>{point.label}: {value(point.value)}</title>
          {data.length <= 6 && <text x={center} y={Math.max(15, y(point.value) - 8)} textAnchor="middle" fontSize="12" fill="#111827">{value(point.value)}</text>}
          <text x={center} y="258" textAnchor="end" transform={`rotate(-20 ${center} 258)`} fontSize="12" fill="#374151">{shortLabel(point.label)}</text>
        </g>;
      })}
      {!total && <text x="415" y="125" textAnchor="middle" fontSize="15" fill="#374151">No activity recorded during these dates.</text>}
    </svg>}
    <dl className="admin-print-chart-values">{data.map((point, index) => <div key={index}>
      <dt><svg viewBox="0 0 12 12" aria-hidden="true" className="admin-print-swatch"><rect width="12" height="12" fill={type === "line" ? colors[0] : colors[index % colors.length]} /></svg>{point.label}</dt>
      <dd>{value(point.value)}{type === "pie" && total > 0 ? ` (${(point.value / total * 100).toFixed(1)}%)` : ""}</dd>
    </div>)}</dl>
  </article>;
}
