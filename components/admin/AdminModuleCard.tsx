import Link from "next/link";
import type { AdminFeatureCard } from "@/components/admin/types";

interface AdminModuleCardProps {
  module: AdminFeatureCard;
}

export default function AdminModuleCard({ module }: AdminModuleCardProps) {
  return (
    <article className="rounded-2xl border border-neutral/10 bg-white p-5">
      <h3 className="text-lg font-semibold text-neutral">{module.title}</h3>
      <p className="mt-2 text-sm text-neutral/70">{module.summary}</p>
      <Link
        href={module.href}
        className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base transition-colors hover:bg-primary/90"
      >
        Open Module
      </Link>
    </article>
  );
}
