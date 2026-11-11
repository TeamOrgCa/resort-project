import Skeleton, { SkeletonGroup } from "@/components/ui/Skeleton";

const panel = "min-w-0 rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6";

/** Keep the real column labels so loading rows follow the table's mobile layout. */
export function AdminTableSkeletonRows({ labels, rows = 5 }: { labels: string[]; rows?: number }) {
  return <>{Array.from({ length: rows }, (_, row) => <tr key={row} aria-hidden="true" className="border-b border-neutral/10 last:border-none">
    {labels.map((label, column) => <td key={column} data-label={label} className="px-4 py-4">
      <Skeleton className={`h-4 max-w-full ${column % 3 === 0 ? "w-32" : "w-20"}`} />
    </td>)}
  </tr>)}</>;
}

export function AdminTableSkeleton({ label = "Loading records...", columns = ["Reference", "Name", "Date", "Status"], rows = 5 }: { label?: string; columns?: string[]; rows?: number }) {
  return <SkeletonGroup label={label} className="min-w-0">
    <div className="admin-table-scroll overflow-x-auto rounded-xl border border-neutral/10">
      <table className="record-table admin-responsive-table w-full min-w-180 text-left text-sm">
        <thead className="border-b border-neutral/10 bg-base/60 text-neutral/60"><tr>{columns.map((column, index) => <th key={index} className="px-4 py-3 font-medium">{column}</th>)}</tr></thead>
        <tbody><AdminTableSkeletonRows labels={columns} rows={rows} /></tbody>
      </table>
    </div>
  </SkeletonGroup>;
}

export function AdminCardsSkeleton({ label = "Loading records...", count = 3 }: { label?: string; count?: number }) {
  return <SkeletonGroup label={label} className="min-w-0 space-y-3">
    <div className="space-y-3">{Array.from({ length: count }, (_, index) => <div key={index} className={`${panel} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
      <div className="min-w-0 flex-1 space-y-3"><Skeleton className="h-5 w-2/5" /><Skeleton className="h-4 w-3/5" /><Skeleton className="h-3 w-1/3" /></div>
      <Skeleton className="h-10 w-24 shrink-0" />
    </div>)}</div>
  </SkeletonGroup>;
}

export function AdminFormSkeleton({ label = "Loading details...", fields = 4 }: { label?: string; fields?: number }) {
  return <SkeletonGroup label={label} className="min-w-0 py-4">
    <div className="grid min-w-0 gap-5 sm:grid-cols-2">{Array.from({ length: fields }, (_, index) => <div key={index} className="min-w-0 space-y-2">
      <Skeleton className="h-4 w-2/5" /><Skeleton className="h-11 w-full" />
    </div>)}</div>
    <Skeleton className="mt-5 h-28 w-full" />
  </SkeletonGroup>;
}

function MetricPlaceholders({ count }: { count: number }) {
  return <div className={`grid gap-4 sm:grid-cols-2 ${count === 4 ? "xl:grid-cols-4" : "xl:grid-cols-3"}`}>
    {Array.from({ length: count }, (_, index) => <div key={index} className={`${panel} space-y-3`}><Skeleton className="h-4 w-2/3" /><Skeleton className="h-8 w-1/3" /><Skeleton className="h-3 w-full" /></div>)}
  </div>;
}

function ChartPlaceholders() {
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
    {[0, 1].map(index => <div key={index} className={panel}><Skeleton className="h-5 w-1/2" /><Skeleton className="mt-6 h-64 w-full" /></div>)}
  </div>;
}

export function AdminReportSkeleton({ label = "Loading report...", metrics = 3 }: { label?: string; metrics?: number }) {
  return <SkeletonGroup label={label} className="mt-5 min-w-0">
    <div className="space-y-5"><MetricPlaceholders count={metrics} /><Skeleton className="h-16 w-full" /><ChartPlaceholders /><Skeleton className="h-64 w-full" /></div>
  </SkeletonGroup>;
}

export function AdminDashboardSkeleton() {
  return <SkeletonGroup label="Loading dashboard..." className="min-w-0">
    <div className="space-y-6"><MetricPlaceholders count={4} /><div className={panel}><Skeleton className="h-5 w-40" /><div className="mt-4"><MetricPlaceholders count={3} /></div></div><ChartPlaceholders /><Skeleton className="h-64 w-full" /></div>
  </SkeletonGroup>;
}

export function AdminWorkspaceSkeleton() {
  return <SkeletonGroup label="Loading workspace..." className="min-w-0">
    <div className="space-y-6"><div className={panel}><Skeleton className="h-7 w-1/3" /><Skeleton className="mt-3 h-4 w-2/3" /></div><div className={panel}><Skeleton className="h-11 w-full" /><Skeleton className="mt-5 h-80 w-full" /></div></div>
  </SkeletonGroup>;
}
