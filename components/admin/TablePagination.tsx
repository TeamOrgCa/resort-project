"use client";

export default function TablePagination({ total, page, pageSize, onPageChange, disabled = false, label = "Table pagination" }: {
  total: number; page: number; pageSize: number; onPageChange: (page: number) => void; disabled?: boolean; label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.max(0, Math.min(page, pages - 1));
  return <nav aria-label={label} className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-4 text-sm text-neutral/60">
    <p>{total ? `Showing ${current * pageSize + 1}–${Math.min((current + 1) * pageSize, total)} of ${total} matching records` : "0 matching records"}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" aria-label="First page" disabled={disabled || current === 0} onClick={() => onPageChange(0)} className="admin-button-secondary px-3">First</button>
      <button type="button" disabled={disabled || current === 0} onClick={() => onPageChange(current - 1)} className="admin-button-secondary px-3">Previous</button>
      <span>Page {current + 1} of {pages}</span>
      <button type="button" disabled={disabled || current >= pages - 1} onClick={() => onPageChange(current + 1)} className="admin-button-secondary px-3">Next</button>
      <button type="button" aria-label="Last page" disabled={disabled || current >= pages - 1} onClick={() => onPageChange(pages - 1)} className="admin-button-secondary px-3">Last</button>
    </div>
  </nav>;
}
