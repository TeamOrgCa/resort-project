"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import ReportChart from "@/components/admin/ReportChart";
import type { AdminTableColumn } from "@/components/admin/types";
import type { DashboardSnapshot } from "@/lib/dashboard/types";
import type { Permission } from "@/lib/auth/role-access";
import { downloadReportCsv } from "@/lib/reports/export";

const columns: AdminTableColumn[] = [
  { key: "reference", label: "Reference", sortType: "text" },
  { key: "guest", label: "Guest", sortType: "text" },
  { key: "checkIn", label: "Arrival", sortType: "date", sortKey: "startSort" },
  { key: "checkOut", label: "Departure", sortType: "date", sortKey: "endSort" },
  { key: "guests", label: "Group size", sortType: "number" },
  { key: "package", label: "Package", sortType: "text" },
  { key: "source", label: "Booked through", sortType: "text" },
  { key: "status", label: "Status", sortType: "text" },
];
const ranges = ["Today", "Next 7 days", "Next 30 days", "Scheduled now"] as const;
type ArrivalRange = (typeof ranges)[number];
const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const dayLabel = (value: string) => new Date(`${value}T00:00:00+08:00`).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" });

export default function AdminDashboard() {
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [arrivalRange, setArrivalRange] = useState<ArrivalRange>("Next 7 days");
  const [breakdown, setBreakdown] = useState<"status" | "source">("status");

  useEffect(() => {
    let mounted = true;
    let controller: AbortController | undefined;
    const load = async () => {
      controller?.abort();
      const request = new AbortController();
      controller = request;
      setLoading(true);
      try {
        const response = await fetch("/api/admin/dashboard", { cache: "no-store", signal: request.signal });
        const payload = await response.json() as { success?: boolean; dashboard?: DashboardSnapshot; message?: string };
        if (!response.ok || !payload.success || !payload.dashboard) throw new Error(payload.message ?? "Unable to load the dashboard. Refresh to try again.");
        if (mounted && !request.signal.aborted) { setDashboard(payload.dashboard); setError(null); }
      } catch (failure) {
        if (mounted && !request.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load the dashboard. Refresh to try again.");
      } finally {
        if (mounted && !request.signal.aborted) setLoading(false);
      }
    };
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => { mounted = false; controller?.abort(); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [refreshKey]);

  const can = (permission: Permission) => dashboard?.permissions.includes(permission) ?? false;
  const refresh = () => setRefreshKey(key => key + 1);
  const rows = useMemo(() => {
    if (!dashboard) return [];
    const now = Date.parse(dashboard.generatedAt);
    const start = Date.parse(`${dashboard.today}T00:00:00+08:00`);
    return dashboard.reservations.filter(row => {
      if (arrivalRange === "Scheduled now") return ["confirmed", "reschedule_requested"].includes(row.statusCode) && Date.parse(row.startSort) <= now && Date.parse(row.endSort) > now;
      const days = arrivalRange === "Today" ? 1 : arrivalRange === "Next 7 days" ? 7 : 30;
      return Date.parse(row.startSort) >= start && Date.parse(row.startSort) < start + days * 86_400_000;
    });
  }, [dashboard, arrivalRange]);

  const queueItems = dashboard ? [
    { title: "Payment proofs", count: dashboard.queues.payments, help: "Awaiting verification", href: "/admin/transactions?tab=payments", permission: "transactions" as const },
    { title: "Reschedule requests", count: dashboard.queues.reschedules, help: "Awaiting a decision", href: "/admin/records?tab=reschedules", permission: "records" as const },
    { title: "Ocular visit requests", count: dashboard.queues.ocular, help: "Awaiting confirmation", href: "/admin/records?tab=ocular", permission: "records" as const },
    { title: "Refund reviews", count: dashboard.queues.refundReview, help: "Awaiting a decision", href: "/admin/transactions?tab=refunds", permission: "transactions" as const },
    { title: "Refund payouts", count: dashboard.queues.refundPayout, help: "Approved, awaiting payout", href: "/admin/transactions?tab=refunds", permission: "transactions" as const },
  ].filter(item => can(item.permission)) : [];

  return <div className="space-y-6 text-neutral" aria-busy={loading}>
    <header className="overflow-hidden rounded-2xl border border-neutral/10 bg-white shadow-sm">
      <div className="flex flex-col gap-4 bg-base/60 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">Resort overview</p>
          <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Dashboard</h1>
          <p className="mt-2 max-w-xl text-sm text-neutral/65">Plan today’s arrivals, check money received and follow up on requests.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refresh} disabled={loading} className="rounded-xl border border-neutral/20 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-base disabled:opacity-50">{loading ? "Refreshing…" : "Refresh dashboard"}</button>
          {can("reservations") && can("create_reservation") && <Link href="/admin/reservations?new=1" className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90">+ New reservation</Link>}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 px-5 py-3 text-xs sm:px-6">
        <p className="text-neutral/60" role="status">{dashboard ? `Updated ${new Date(dashboard.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} · Philippine time · Refreshes every minute` : "Loading resort records…"}</p>
        <nav aria-label="Dashboard shortcuts" className="flex flex-wrap gap-4 font-semibold text-primary">
          {can("reservations") && <Link href="/admin/reservations" className="hover:underline">Reservation calendar →</Link>}
          {can("reports") && <Link href="/admin/reports" className="hover:underline">Reports →</Link>}
          {can("analytics") && <Link href="/admin/analytics" className="hover:underline">Analytics →</Link>}
        </nav>
      </div>
    </header>

    {error && <div role="alert" className="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">{error}{dashboard && <p className="mt-1 font-semibold">Showing the last successful update. Refresh before acting on these figures.</p>}</div>}
    {!dashboard && loading && <div className="grid animate-pulse gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Loading dashboard"><div className="h-32 rounded-2xl bg-neutral/5" /><div className="h-32 rounded-2xl bg-neutral/5" /><div className="h-32 rounded-2xl bg-neutral/5" /><div className="h-32 rounded-2xl bg-neutral/5" /></div>}

    {dashboard && <>
      <section aria-label="Today’s overview">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Today at the resort</h2><p className="text-sm text-neutral/60">{dayLabel(dashboard.today)}</p></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Arrivals today", value: dashboard.arrivalsToday.toLocaleString("en-PH"), help: "Active reservations starting today, including payment holds still valid." },
            { label: "Scheduled now", value: dashboard.scheduledNow.toLocaleString("en-PH"), help: "Confirmed bookings within their stay times; not a check-in attendance count." },
            { label: "Collections today", value: money(dashboard.collectionsToday), help: `${dashboard.verifiedToday} verified payments. Money received before refunds.` },
            { label: "Bookings created", value: dashboard.bookingsCreated.toLocaleString("en-PH"), help: "Last 7 days, including today. All reservation statuses." },
          ].map(item => <article key={item.label} className="rounded-2xl border border-neutral/10 bg-white p-5 shadow-sm"><p className="text-sm font-medium text-neutral/65">{item.label}</p><p className="mt-2 break-words text-3xl font-semibold tracking-tight">{item.value}</p><p className="mt-2 text-xs leading-relaxed text-neutral/60">{item.help}</p></article>)}
        </div>
      </section>

      {queueItems.length > 0 && <section className="rounded-2xl border border-neutral/10 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-semibold">Needs attention</h2>
        <p className="mt-1 text-sm text-neutral/60">All unresolved requests, including those submitted before this week. Open a queue to review its records.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {queueItems.map(item => <Link key={item.title} href={item.href} className="group flex flex-col rounded-xl border border-neutral/10 bg-base/50 p-4 transition-colors hover:border-primary/40 hover:bg-primary/5">
            <span className="text-sm font-medium">{item.title}</span><span className={`mt-2 text-3xl font-semibold ${item.count ? "text-primary" : "text-neutral/50"}`}>{item.count.toLocaleString("en-PH")}</span><span className="mt-1 text-xs text-neutral/60">{item.help}</span><span className="mt-4 text-xs font-semibold text-primary group-hover:underline">Open queue →</span>
          </Link>)}
        </div>
      </section>}

      <section aria-label="Last seven days">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Last 7 days</h2><p className="text-sm text-neutral/60">{dayLabel(dashboard.startDate)} – {dayLabel(dashboard.endDate)}</p></div>
        <div className="grid items-start gap-4 xl:grid-cols-3">
          <div className="min-w-0 xl:col-span-2"><ReportChart title="Verified collections" format="money" points={dashboard.collections} description="Actual payments by verification date, before refunds. Older payments without a verification date use their creation date. Today’s total may still change." /></div>
          <div className="min-w-0 rounded-xl border border-neutral/10 bg-white">
            <div className="flex gap-1 border-b border-neutral/10 bg-base/50 p-3" role="group" aria-label="Booking breakdown">
              {(["status", "source"] as const).map(tab => <button key={tab} type="button" aria-pressed={breakdown === tab} onClick={() => setBreakdown(tab)} className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium ${breakdown === tab ? "bg-white text-primary shadow-sm" : "text-neutral/60 hover:bg-white/60"}`}>{tab === "status" ? "Booking status" : "Booking source"}</button>)}
            </div>
            <ReportChart key={breakdown} title={breakdown === "status" ? "Status of new bookings" : "Where bookings came from"} initialType="pie" points={breakdown === "status" ? dashboard.bookingStatuses : dashboard.bookingSources} description={breakdown === "status" ? "Current recorded status of reservations created in the last 7 days, including cancelled or expired bookings." : "Reservations created in the last 7 days. Staff entry includes phone, Messenger and walk-in bookings."} />
          </div>
        </div>
      </section>

      <section aria-label="Arrivals and stays">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Arrivals & stays</h2><p className="mt-1 text-sm text-neutral/60">Today and the next 29 days, through {dayLabel(dashboard.arrivalEndDate)}. Closed bookings and expired payment holds are excluded.</p></div>
          <div className="flex flex-wrap gap-1 rounded-xl bg-neutral/5 p-1" role="group" aria-label="Arrival period">{ranges.map(range => <button key={range} type="button" onClick={() => setArrivalRange(range)} aria-pressed={arrivalRange === range} className={`rounded-lg px-3 py-2 text-xs font-semibold ${arrivalRange === range ? "bg-white text-primary shadow-sm" : "text-neutral/60 hover:bg-white/60"}`}>{range}</button>)}</div>
        </div>
        <AdminTablePreview key={arrivalRange} title={arrivalRange === "Scheduled now" ? "Bookings scheduled now" : `Arrivals · ${arrivalRange.toLowerCase()}`} columns={columns} rows={rows} defaultSort={{ key: "checkIn", direction: "asc" }} pageSize={10} showResetFilters searchPlaceholder="Search guest or reservation reference…"
          filters={[{ key: "status", label: "Status", options: [...new Set(rows.map(r => r.status))].sort() }, { key: "source", label: "Booked through", options: ["Online", "Staff entry", "Unspecified"] }]}
          actions={["Export CSV", "Refresh"]} isActionDisabled={(action, filtered) => loading || (action === "Export CSV" && (!filtered.length || Boolean(error)))}
          onAction={(action, filtered) => { if (action === "Refresh") refresh(); else downloadReportCsv(columns, filtered, `dashboard-arrivals-${arrivalRange.toLowerCase().replaceAll(" ", "-")}-${dashboard.today}.csv`); }}
          rowActions={can("reservations") ? ["View"] : []} isRowActionDisabled={() => loading}
          onRowAction={(_action, row) => router.push(`/admin/reservations?reservation=${encodeURIComponent(row.id)}&date=${encodeURIComponent(row.arrivalDate)}`)}
        />
        <p className="mt-2 text-xs text-neutral/60">Search, status and source filters affect this table and its CSV export. The cards and charts keep their stated scopes. CSV includes every matching row across pages.</p>
      </section>
    </>}
  </div>;
}
