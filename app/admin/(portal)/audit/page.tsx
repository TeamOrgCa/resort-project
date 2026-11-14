"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";
import { downloadReportCsv } from "@/lib/reports/export";
import { InvalidDateRangeError, parseCustomDateRange } from "@/lib/server/custom-date-range";
import { AUDIT_PERIODS, type AuditPeriod } from "@/lib/admin/audit-date-range";
import { formatManilaDate } from "@/lib/booking/manila-date";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";

const auditColumns: AdminTableColumn[] = [
  { key: "staff", label: "Person / Account", sortType: "text" },
  { key: "module", label: "Area", sortType: "text" },
  { key: "action", label: "What happened", sortType: "text" },
  { key: "record", label: "Related record", sortType: "text" },
  { key: "summaryPreview", label: "Details", sortType: "text" },
  { key: "timestamp", label: "Date & Time", sortKey: "occurredAt", sortType: "date" },
];

const formatDateTime = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

export default function AdminAuditPage() {
  const [revision, setRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminTableRow[]>([]);
  const [selected, setSelected] = useState<AdminTableRow | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [period, setPeriod] = useState<AuditPeriod>("today");
  const [range, setRange] = useState<{ period: AuditPeriod; startDate?: string; endDate?: string }>({ period: "today" });
  const [resolvedRange, setResolvedRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchAuditRows = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);

        const params = new URLSearchParams({ period: range.period });
        if (range.startDate && range.endDate) { params.set("startDate", range.startDate); params.set("endDate", range.endDate); }
        const query = `?${params}`;
        const response = await fetch(`/api/admin/audit${query}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; message?: string; rows?: AdminTableRow[]; hasMore?: boolean; dateRange?: { startDate: string; endDate: string } }
          | null;

        if (!response.ok || !payload?.success || !Array.isArray(payload.rows)) {
          throw new Error(payload?.message ?? "Failed to load audit logs.");
        }

        if (!isMounted) return;
        setHasMore(Boolean(payload.hasMore));
        setResolvedRange(payload.dateRange ?? null);

        setRows(
          payload.rows.map((row) => ({
            ...row,
            occurredAt: row.timestamp,
            timestamp: formatDateTime(row.timestamp),
          }))
        );
      } catch (error) {
        if (!isMounted) return;
        setFetchError(error instanceof Error ? error.message : "Failed to load audit logs.");
        setRows([]);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchAuditRows();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [revision, range]);

  const moduleOptions = useMemo(
    () => [...new Set(rows.map((row) => row.module))].filter(Boolean),
    [rows]
  );

  const staffOptions = useMemo(
    () => [...new Set(rows.map((row) => row.staff))].filter(Boolean),
    [rows]
  );

  function applyPeriod(next: AuditPeriod) {
    setPeriod(next); setRangeError(null);
    if (next === "custom") return;
    setSelected(null); setRows([]); setIsLoading(true); setHasMore(false); setResolvedRange(null); setRange({ period: next });
  }

  return (
    <div>
      <AdminSectionHeader
        title="Audit Log"
        subtitle="See who acted, what changed and which booking or account was affected."
      />

      <section className="admin-panel mb-5" aria-label="Audit date range">
        <div className="mb-4"><h2 className="text-lg font-semibold text-neutral">Activity period</h2><p className="mt-1 text-sm text-neutral/65">Dates use Philippine time. This week is the current Monday through Sunday.</p></div>
        <label className="mb-4 flex max-w-xs flex-col gap-1.5 text-sm font-medium text-neutral/70">Show activity for
          <select aria-label="Audit period" value={period} onChange={event => applyPeriod(event.target.value as AuditPeriod)} className="admin-field">
            {Object.entries(AUDIT_PERIODS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {period === "custom" && <>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault();
          try {
            parseCustomDateRange(startDate, endDate);
            setRangeError(null); setIsLoading(true); setRows([]); setHasMore(false); setSelected(null); setResolvedRange(null); setRange({ period: "custom", startDate, endDate });
          } catch (cause) { setRangeError(cause instanceof InvalidDateRangeError ? cause.message : "Choose a valid date range."); }
        }}>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-neutral/70">From<input aria-label="Audit start date" type="date" required value={startDate} onChange={event => { setStartDate(event.target.value); setRangeError(null); }} className="admin-field" /></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-neutral/70">Through<input aria-label="Audit end date" type="date" required min={startDate || undefined} value={endDate} onChange={event => { setEndDate(event.target.value); setRangeError(null); }} className="admin-field" /></label>
          <button type="submit" className="admin-button-primary">Apply dates</button>
          <button type="button" className="admin-button-secondary" onClick={() => { setStartDate(""); setEndDate(""); applyPeriod("today"); }}>Reset to today</button>
        </form>
        {rangeError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{rangeError}</p>}
        <p className="mt-2 text-xs text-neutral/60">Custom dates take effect after you select Apply dates.</p>
        </>}
        <p role="status" className="mt-3 text-xs text-neutral/60">{isLoading ? "Loading activity..." : `Applied: ${AUDIT_PERIODS[range.period]}${resolvedRange ? ` · ${formatManilaDate(resolvedRange.startDate)} through ${formatManilaDate(resolvedRange.endDate)}` : ""}`}. {hasMore ? "Showing the latest 300 matching entries. Narrow the date range to see older activity." : "Up to 300 matching entries are shown."} Export follows the applied period and table filters.</p>
      </section>

      {fetchError ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}

      <AdminTablePreview
        title="Recent Activity"
        isLoading={isLoading}
        columns={auditColumns}
        rows={rows}
        defaultSort={{ key: "timestamp", direction: "desc" }}
        paginationResetKey={JSON.stringify(range)}
        filters={[
          { key: "module", label: "Area", options: moduleOptions },
          { key: "staff", label: "Person / Account", options: staffOptions },
        ]}
        pageSize={25}
        showResetFilters
        actions={["Refresh log", "Export Log"]}
        allowReadOnlyExport
        isActionDisabled={(action, filteredRows) => isLoading || (action === "Export Log" && (!filteredRows.length || Boolean(fetchError)))}
        onAction={(action, filteredRows) => { if (action === "Refresh log") { setSelected(null); setRevision(value => value + 1); } else downloadReportCsv(auditColumns.map(column => column.key === "summaryPreview" ? { ...column, key: "summary" } : column), filteredRows, "audit-log.csv"); }}
        rowActions={["View Details"]}
        isRowActionDisabled={() => isLoading}
        onRowAction={(_, row) => setSelected(row)}
      />
      {selected && <CatalogDialog title="Audit details" description={selected.action} busy={false} onClose={() => setSelected(null)}>
          <dl className="mt-3 grid gap-3 rounded-xl border border-neutral/10 p-4 text-sm sm:grid-cols-2">
            {[ ["Person / account", selected.staff], ["Area", selected.module], ["Related record", selected.record], ["When (Philippine time)", selected.timestamp] ].map(([label,value]) => <div key={label}><dt className="text-xs text-neutral/60">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
          </dl>
          <div className="mt-4 rounded-xl bg-base p-4"><h3 className="mb-2 text-sm font-semibold">Recorded details</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{selected.summary}</p></div>
          {(selected.recordId || selected.details) && <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Technical details</summary>
            <p className="mt-2 text-xs text-neutral/60">Original saved data for tracing or technical support.</p>
            {selected.originalAction && <p className="mt-2 break-words">Original action: {selected.originalAction}</p>}
            {selected.recordId && <p className="mt-2 break-all">Record ID: {selected.recordId}</p>}
            {selected.details && <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-base p-3 text-xs">{selected.details}</pre>}
          </details>}
      </CatalogDialog>}
    </div>
  );
}
