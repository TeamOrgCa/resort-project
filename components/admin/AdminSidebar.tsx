"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { adminNavigation } from "@/components/admin/content";

export default function AdminSidebar() {
  const pathname = usePathname();

  return (
    <div className="rounded-2xl border border-neutral/10 bg-white p-4">
      <div className="mb-4 border-b border-neutral/10 pb-4">
        <p className="text-sm font-semibold text-primary">MarVille Admin</p>
        <h2 className="text-xl font-bold text-neutral">Management System</h2>
      </div>

      <nav className="space-y-2">
        {adminNavigation.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/admin" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-xl border px-3 py-3 transition-colors ${
                isActive
                  ? "border-primary/30 bg-primary/10"
                  : "border-transparent bg-base hover:border-neutral/20"
              }`}
            >
              <p className="font-semibold text-neutral">{item.label}</p>
              <p className="text-xs text-neutral/70">{item.description}</p>
            </Link>
          );
        })}
      </nav>

      <div className="mt-4 rounded-xl bg-base p-3 text-sm text-neutral/80">
        Static prototype UI. Connect each module to live data when backend endpoints are ready.
      </div>
    </div>
  );
}
