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
  rowActions?: string[];
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
  rowActions = [],
}: AdminTablePreviewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({});
  const [sortState, setSortState] = useState<AdminTableSort | null>(defaultSort ?? null);

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
    <section className="rounded-2xl border border-neutral/10 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-lg font-semibold text-neutral">{title}</h3>

        {actions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action}
                type="button"
                className="rounded-lg border border-neutral/20 px-3 py-2 text-xs font-semibold text-neutral transition-colors hover:bg-base"
              >
                {action}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {(enableSearch || filters.length > 0) && (
        <div className="mb-4 flex flex-wrap gap-3 rounded-xl bg-base p-3">
          {enableSearch ? (
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-55 flex-1 rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
          ) : null}

          {filters.map((filter) => (
            <label key={filter.key} className="flex items-center gap-2 text-xs text-neutral/70">
              <span>{filter.label}</span>
              <select
                value={activeFilters[filter.key] ?? "all"}
                onChange={(event) =>
                  setActiveFilters((current) => ({
                    ...current,
                    [filter.key]: event.target.value,
                  }))
                }
                className="rounded-lg border border-neutral/20 bg-white px-2 py-2 text-xs text-neutral"
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
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-neutral/10 text-neutral/70">
            <tr>
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
                          className="rounded-md border border-neutral/20 px-2 py-1 text-xs font-medium text-neutral hover:bg-base"
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
                  colSpan={columns.length + (rowActions.length > 0 ? 1 : 0)}
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
