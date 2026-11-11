import Skeleton, { SkeletonGroup } from "@/components/ui/Skeleton";

export default function ManageBookingSkeleton({ ocular = false }: { ocular?: boolean }) {
  return <SkeletonGroup label={ocular ? "Loading your ocular visits..." : "Loading your records..."}>
    <div className="space-y-4">{[0, 1, 2].map(index => <div key={index} className="overflow-hidden rounded-2xl border border-neutral/10">
      <div className="space-y-3 p-4 sm:p-5"><Skeleton className="h-5 w-40 max-w-full" /><Skeleton className="h-3 w-32" /><Skeleton className="h-6 w-24 rounded-full" /></div>
      <div className={`grid gap-4 border-t border-neutral/5 p-4 sm:p-5 ${ocular ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"}`}>
        {Array.from({ length: ocular ? 3 : 4 }, (_, field) => <div key={field} className="space-y-2"><Skeleton className="h-3 w-20" /><Skeleton className="h-4 w-32 max-w-full" /></div>)}
      </div>
    </div>)}</div>
  </SkeletonGroup>;
}
