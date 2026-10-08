"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
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
    year: "numeric",
    month: "short",
    day: "numeric",
  })} ${date.toLocaleTimeString("en-PH", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

export default function AdminAuditPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [rows, setRows] = useState<AdminTableRow[]>([]);
  const [selected, setSelected] = useState<AdminTableRow | null>(null);

  useEffect(() => {
    let isMounted = true;

    const fetchAuditRows = async () => {
      try {
        setIsLoading(true);
        setFetchError(null);

        const response = await fetch("/api/admin/audit", {
          method: "GET",
        });

        const payload = (await response.json().catch(() => null)) as
          | { success?: boolean; message?: string; rows?: AdminTableRow[] }
          | null;

        if (!response.ok || !payload?.success || !Array.isArray(payload.rows)) {
          throw new Error(payload?.message ?? "Failed to load audit logs.");
        }

        if (!isMounted) return;

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
    };
  }, []);

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

      {fetchError ? (
        <p className="mb-4 rounded-lg border border-highlight/40 bg-highlight/10 px-3 py-2 text-sm text-neutral">
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
        actions={["Export Log"]}
        rowActions={["View Details"]}
        onRowAction={(_, row) => setSelected(row)}
      />
      {selected && <div className="fixed inset-0 z-50 flex items-center justify-center bg-neutral/50 p-4" role="dialog" aria-modal="true" aria-label="Audit details" onClick={() => setSelected(null)}>
        <div className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-xl bg-white p-5" onClick={(event) => event.stopPropagation()}>
          <div className="flex justify-between gap-4"><h2 className="text-lg font-semibold">{selected.action}</h2><button onClick={() => setSelected(null)}>Close</button></div>
          <p className="mt-2 text-sm">Actor: {selected.staff}</p><p className="text-sm">Record: {selected.record}</p><p className="text-sm">Time: {selected.timestamp}</p>
          <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded bg-base p-3 text-sm font-sans">{selected.summary}</pre>
          {(selected.recordId || selected.details) && <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium">Technical details</summary>
            {selected.recordId && <p className="mt-2 break-all">Record ID: {selected.recordId}</p>}
            {selected.details && <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-base p-3 text-xs">{selected.details}</pre>}
          </details>}
        </div>
      </div>}
    </div>
  );
}
