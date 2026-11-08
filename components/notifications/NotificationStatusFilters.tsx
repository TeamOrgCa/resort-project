"use client";

export type NotificationFilter = "All" | "Read" | "Unread";

export default function NotificationStatusFilters({ value, onChange }: {
  value: NotificationFilter; onChange: (value: NotificationFilter) => void;
}) {
  return <div role="group" aria-label="Notification status" className="mt-3 flex justify-start gap-2">
    {(["All", "Read", "Unread"] as const).map(filter => <button key={filter} type="button" aria-pressed={value === filter}
      onClick={() => onChange(filter)} className={`min-h-11 rounded-lg border px-3 text-xs font-semibold transition-colors ${value === filter
        ? "border-primary bg-primary text-white" : "border-neutral/30 bg-white text-neutral/80 hover:border-primary/60 hover:bg-primary/15 hover:text-primary"}`}>{filter}</button>)}
  </div>;
}

export const notificationMatchesFilter = (item: { is_read: boolean }, filter: NotificationFilter) =>
  filter === "All" || (filter === "Read" ? item.is_read : !item.is_read);

export const notificationStatusClass = (isRead: boolean) => isRead
  ? "border-neutral/10 bg-slate-50" : "border-blue-200 border-l-4 border-l-blue-600 bg-blue-50";
