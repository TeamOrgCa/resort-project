"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";
import { downloadReportCsv } from "@/lib/reports/export";
import { InvalidDateRangeError, parseCustomDateRange } from "@/lib/server/custom-date-range";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";

const auditColumns: AdminTableColumn[] = [
  { key: "staff", label: "Actor / Email" },
  { key: "module", label: "Module" },
  { key: "action", label: "Action" },
  { key: "record", label: "Affected Record" },
  { key: "timestamp", label: "Date & Time" },
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
  const [range, setRange] = useState<{ startDate: string; endDate: string } | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const fetchAuditRows = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);

        const query = range ? `?${new URLSearchParams(range)}` : "";
        const response = await fetch(`/api/admin/audit${query}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; message?: string; rows?: AdminTableRow[]; hasMore?: boolean }
          | null;

        if (!response.ok || !payload?.success || !Array.isArray(payload.rows)) {
          throw new Error(payload?.message ?? "Failed to load audit logs.");
        }

        if (!isMounted) return;
        setHasMore(Boolean(payload.hasMore));

        setRows(
          payload.rows.map((row) => ({
            ...row,
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

  return (
    <div>
      <AdminSectionHeader
        title="Audit Log"
        subtitle="Chronological record of staff actions, guest bookings, and account access attempts."
      />

      <section className="admin-panel mb-5" aria-label="Audit date range">
        <div className="mb-4"><h2 className="text-lg font-semibold text-neutral">Date range</h2><p className="mt-1 text-sm text-neutral/65">Choose the first and last day to include. Dates use Philippine time.</p></div>
        <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
          event.preventDefault();
          try {
            parseCustomDateRange(startDate, endDate);
            setRangeError(null); setIsLoading(true); setRows([]); setHasMore(false); setSelected(null); setRange({ startDate, endDate });
          } catch (cause) { setRangeError(cause instanceof InvalidDateRangeError ? cause.message : "Choose a valid date range."); }
        }}>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-neutral/70">From<input aria-label="Audit start date" type="date" required value={startDate} onChange={event => { setStartDate(event.target.value); setRangeError(null); }} className="admin-field" /></label>
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium text-neutral/70">Through<input aria-label="Audit end date" type="date" required value={endDate} onChange={event => { setEndDate(event.target.value); setRangeError(null); }} className="admin-field" /></label>
          <button type="submit" className="admin-button-primary">Apply dates</button>
          <button type="button" className="admin-button-secondary" disabled={!startDate && !endDate && !range} onClick={() => { setStartDate(""); setEndDate(""); setRangeError(null); setSelected(null); if (range) { setIsLoading(true); setRows([]); setHasMore(false); } setRange(null); }}>Clear dates</button>
        </form>
        {rangeError && <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{rangeError}</p>}
        <p role="status" className="mt-3 text-xs text-neutral/60">{range ? `Applied: ${range.startDate} through ${range.endDate}` : "All dates"}. {hasMore ? "Showing the latest 300 matching entries. Narrow the date range to see older activity." : "Up to 300 matching entries are shown."} Export follows the applied dates and table filters.</p>
      </section>

      {fetchError ? (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {fetchError}
        </p>
      ) : null}

      <AdminTablePreview
        title={isLoading ? "Recent Activity (Loading...)" : "Recent Activity"}
        columns={auditColumns}
        rows={rows}
        defaultSort={{ key: "timestamp", direction: "desc" }}
        filters={[
          { key: "module", label: "Module", options: moduleOptions },
          { key: "staff", label: "Actor / Email", options: staffOptions },
        ]}
        pageSize={25}
        showResetFilters
        actions={["Refresh log", "Export Log"]}
        isActionDisabled={(action, filteredRows) => isLoading || (action === "Export Log" && (!filteredRows.length || Boolean(fetchError)))}
        onAction={(action, filteredRows) => { if (action === "Refresh log") setRevision(value => value + 1); else downloadReportCsv(auditColumns, filteredRows, "audit-log.csv"); }}
        rowActions={["View Details"]}
        isRowActionDisabled={() => isLoading}
        onRowAction={(_, row) => setSelected(row)}
      />
      {selected && <CatalogDialog title="Audit details" description={selected.action} busy={false} onClose={() => setSelected(null)}>
          <p className="mt-2 text-sm">Actor: {selected.staff}</p><p className="text-sm">Record: {selected.record}</p><p className="text-sm">Time: {selected.timestamp}</p>
          <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded bg-base p-3 text-sm font-sans">{selected.summary}</pre>
          {(selected.recordId || selected.details) && <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Technical details</summary>
            {selected.recordId && <p className="mt-2 break-all">Record ID: {selected.recordId}</p>}
            {selected.details && <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-base p-3 text-xs">{selected.details}</pre>}
          </details>}
      </CatalogDialog>}
    </div>
  );
}
