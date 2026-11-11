import type { ReactNode } from "react";

export default function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-neutral/10 motion-reduce:animate-none ${className}`} />;
}

export function SkeletonGroup({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div role="status" aria-live="polite" aria-busy="true" data-no-auto-scroll className={className}>
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{children}</div>
  </div>;
}
