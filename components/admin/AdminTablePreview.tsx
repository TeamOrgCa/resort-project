"use client";

import { useMemo, useState } from "react";
import type {
  AdminTableColumn,
  AdminTableFilter,
  AdminTableRow,
  AdminTableSort,
} from "@/components/admin/types";

interface AdminTablePreviewProps {
  title: string;
  columns: AdminTableColumn[];
  rows: AdminTableRow[];
  enableSearch?: boolean;
  searchPlaceholder?: string;
  filters?: AdminTableFilter[];
  defaultSort?: AdminTableSort;
  sortable?: boolean;
  actions?: string[];
  onAction?: (action: string) => void | Promise<void>;
  isActionDisabled?: (action: string) => boolean;
  rowActions?: string[];
  onRowAction?: (action: string, row: AdminTableRow) => void | Promise<void>;
  isRowActionDisabled?: (action: string, row: AdminTableRow) => boolean;
  selectableRows?: boolean;
  singleSelect?: boolean;
  selectedRowIds?: string[];
  onSelectedRowIdsChange?: (rowIds: string[]) => void;
}

function compareValues(left: string, right: string) {
  const leftDate = Date.parse(left);
  const rightDate = Date.parse(right);

  if (!Number.isNaN(leftDate) && !Number.isNaN(rightDate)) {
    return leftDate - rightDate;
  }

  const leftNumber = Number.parseFloat(left.replace(/[^\d.-]/g, ""));
  const rightNumber = Number.parseFloat(right.replace(/[^\d.-]/g, ""));

  if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) {
    return leftNumber - rightNumber;
  }

  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

export default function AdminTablePreview({
  title,
  columns,
  rows,
  enableSearch = true,
  searchPlaceholder = "Search records...",
  filters = [],
  defaultSort,
  sortable = true,
  actions = [],
  onAction,
  isActionDisabled,
  rowActions = [],
  onRowAction,
  isRowActionDisabled,
  selectableRows = false,
  singleSelect = false,
  selectedRowIds,
  onSelectedRowIdsChange,
}: AdminTablePreviewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [sortState, setSortState] = useState<AdminTableSort | null>(defaultSort ?? null);
  const [internalSelectedRowIds, setInternalSelectedRowIds] = useState<string[]>([]);

  const resolvedSelectedRowIds = selectedRowIds ?? internalSelectedRowIds;

  const updateSelectedRows = (nextRowIds: string[]) => {
    if (onSelectedRowIdsChange) {
      onSelectedRowIdsChange(nextRowIds);
      return;
    }

    setInternalSelectedRowIds(nextRowIds);
  };

  const toggleRowSelection = (rowId: string) => {
    const isAlreadySelected = resolvedSelectedRowIds.includes(rowId);

    if (singleSelect) {
      updateSelectedRows(isAlreadySelected ? [] : [rowId]);
      return;
    }

    if (isAlreadySelected) {
      updateSelectedRows(resolvedSelectedRowIds.filter((selectedId) => selectedId !== rowId));
      return;
    }

    updateSelectedRows([...resolvedSelectedRowIds, rowId]);
  };

  const filteredRows = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesSearch =
        !normalizedSearch ||
        columns.some((column) => (row[column.key] ?? "").toLowerCase().includes(normalizedSearch));

      if (!matchesSearch) {
        return false;
      }

      return filters.every((filter) => {
        const selected = activeFilters[filter.key];
        if (!selected || selected === "all") {
          return true;
        }

        return (row[filter.key] ?? "").toLowerCase() === selected.toLowerCase();
      });
    });
  }, [activeFilters, columns, filters, rows, searchTerm]);

  const sortedRows = useMemo(() => {
    if (!sortState) {
      return filteredRows;
    }

    return [...filteredRows].sort((left, right) => {
      const leftValue = left[sortState.key] ?? "";
      const rightValue = right[sortState.key] ?? "";
      const compared = compareValues(leftValue, rightValue);

      return sortState.direction === "asc" ? compared : -compared;
    });
  }, [filteredRows, sortState]);

  const handleSort = (key: string) => {
    if (!sortable) {
      return;
    }

    setSortState((current) => {
      if (!current || current.key !== key) {
        return { key, direction: "asc" };
      }

      if (current.direction === "asc") {
        return { key, direction: "desc" };
      }

      return null;
    });
  };

  return (
    <section className="rounded-2xl border border-neutral/10 bg-white p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <h3 className="text-lg font-semibold text-neutral">{title}</h3>

        {actions.length > 0 ? (
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                onClick={() => onAction?.(action)}
                disabled={isActionDisabled?.(action)}
                className="rounded-lg border border-neutral/20 px-3 py-2 text-xs font-semibold text-neutral transition-colors hover:bg-base disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                {action}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {(enableSearch || filters.length > 0) && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl bg-base p-3 sm:flex-row sm:flex-wrap sm:items-center">
          {enableSearch ? (
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={searchPlaceholder}
              className="w-full min-w-0 flex-1 rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none sm:min-w-55"
            />
          ) : null}

          {filters.map((filter) => (
            <label key={filter.key} className="flex w-full items-center justify-between gap-2 text-xs text-neutral/70 sm:w-auto sm:justify-start">
              <span>{filter.label}</span>
              <select
                value={activeFilters[filter.key] ?? "all"}
                onChange={(event) =>
                  setActiveFilters((current) => ({
                    ...current,
                    [filter.key]: event.target.value,
                  }))
                }
                className="w-40 rounded-lg border border-neutral/20 bg-white px-2 py-2 text-xs text-neutral sm:w-auto"
              >
                <option value="all">All</option>
                {filter.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-180 text-left text-sm sm:min-w-full">
          <thead className="border-b border-neutral/10 text-neutral/70">
            <tr>
              {selectableRows ? <th className="px-3 py-2 font-medium" aria-label="Select" /> : null}

              {columns.map((column) => (
                <th key={column.key} className="px-3 py-2 font-medium">
                  <button
                    type="button"
                    onClick={() => handleSort(column.key)}
                    disabled={!sortable}
                    className={`inline-flex items-center gap-1 ${sortable ? "hover:text-neutral" : "cursor-default"}`}
                  >
                    {column.label}
                    {sortState?.key === column.key ? (
                      <span>{sortState.direction === "asc" ? "↑" : "↓"}</span>
                    ) : sortable ? (
                      <span className="text-neutral/40">↕</span>
                    ) : null}
                  </button>
                </th>
              ))}

              {rowActions.length > 0 && <th className="px-3 py-2 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.id} className="border-b border-neutral/10 last:border-none">
                {selectableRows ? (
                  <td className="px-3 py-3 text-neutral/90">
                    <input
                      type="checkbox"
                      checked={resolvedSelectedRowIds.includes(row.id)}
                      onChange={() => toggleRowSelection(row.id)}
                      className="h-4 w-4 rounded border-neutral/30"
                      aria-label={`Select row ${row.id}`}
                    />
                  </td>
                ) : null}

                {columns.map((column) => (
                  <td key={`${row.id}-${column.key}`} className="px-3 py-3 text-neutral/90">
                    {row[column.key] ?? "-"}
                  </td>
                ))}

                {rowActions.length > 0 && (
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      {rowActions.map((action) => (
                        <button
                          key={`${row.id}-${action}`}
                          type="button"
                          onClick={() => onRowAction?.(action, row)}
                          disabled={isRowActionDisabled?.(action, row)}
                          className="whitespace-nowrap rounded-md border border-neutral/20 px-2 py-1 text-xs font-medium text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </td>
                )}
              </tr>
            ))}

            {sortedRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (rowActions.length > 0 ? 1 : 0) + (selectableRows ? 1 : 0)}
                  className="px-3 py-6 text-center text-sm text-neutral/60"
                >
                  No records match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
