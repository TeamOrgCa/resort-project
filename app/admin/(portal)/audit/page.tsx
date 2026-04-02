"use client";

import { useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableRow } from "@/components/admin/types";

const auditColumns: AdminTableColumn[] = [
  { key: "staff", label: "Staff" },
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
        subtitle="Chronological record of staff actions for accountability and transparency."
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
          { key: "staff", label: "Staff", options: staffOptions },
        ]}
        actions={["Export Log"]}
        rowActions={["View Details"]}
      />
    </div>
  );
}
