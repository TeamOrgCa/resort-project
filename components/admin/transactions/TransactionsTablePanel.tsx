"use client";

import AdminTablePreview from "@/components/admin/AdminTablePreview";
import type { AdminTableColumn, AdminTableFilter, AdminTableRow, AdminTableSort } from "@/components/admin/types";

interface TransactionsTablePanelProps {
  title: string;
  columns: AdminTableColumn[];
  rows: AdminTableRow[];
  defaultSort?: AdminTableSort;
  filters?: AdminTableFilter[];
  actions?: string[];
  rowActions?: string[];
  onAction?: (action: string) => void | Promise<void>;
  onRowAction?: (action: string, row: AdminTableRow) => void | Promise<void>;
  isLoading?: boolean;
}

export default function TransactionsTablePanel({
  title,
  columns,
  rows,
  defaultSort,
  filters,
  actions,
  rowActions,
  onAction,
  onRowAction,
}: TransactionsTablePanelProps) {
  return (
    <AdminTablePreview
      title={title}
      columns={columns}
      rows={rows}
      defaultSort={defaultSort}
      filters={filters}
      actions={actions}
      rowActions={rowActions}
      onAction={onAction}
      onRowAction={onRowAction}
    />
  );
}