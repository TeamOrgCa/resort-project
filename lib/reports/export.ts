type Column = { key: string; label: string };
type Row = { [key: string]: string };

export function reportCsv(columns: readonly Column[], rows: readonly Row[]): string {
  const escape = (value: string) => {
    const safe = /^[\s\u0000-\u001f]*[=+@-]/.test(value) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  return "\uFEFF" + [columns.map(c => c.label), ...rows.map(row => columns.map(c => row[c.key] ?? ""))]
    .map(line => line.map(escape).join(",")).join("\r\n");
}

export function downloadReportCsv(columns: readonly Column[], rows: readonly Row[], filename: string): void {
  const url = URL.createObjectURL(new Blob([reportCsv(columns, rows)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
