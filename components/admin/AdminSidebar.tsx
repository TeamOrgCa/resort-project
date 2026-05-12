"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { adminNavigation } from "@/components/admin/content";
import { filterNavigationByRole } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/client";
import type { StaffRole } from "@/lib/auth/staff-auth";

interface AdminSidebarProps {
  role: StaffRole;
}

export default function AdminSidebar({ role }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/admin/login");
  };

  // Filter navigation based on role
  const filteredNavigation = filterNavigationByRole(adminNavigation, role);

  return (
    <div className="rounded-2xl border border-neutral/10 bg-white p-3 sm:p-4">
      <div className="mb-4 border-b border-neutral/10 pb-4">
        <p className="text-sm font-semibold text-primary">MarVille Admin</p>
        <h2 className="text-xl font-bold text-neutral">Management System</h2>
      </div>

      <nav className="-mx-1 flex gap-2 overflow-x-auto pb-1 sm:mx-0 sm:block sm:space-y-2 sm:overflow-visible sm:pb-0">
        {filteredNavigation.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/admin" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block min-w-56 rounded-xl border px-3 py-3 transition-colors sm:min-w-0 ${
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

      <button
        type="button"
        onClick={handleLogout}
        className="mt-4 w-full rounded-xl border border-neutral/20 bg-white px-3 py-2 text-sm font-semibold text-neutral hover:bg-base"
      >
        Log out
      </button>

      <div className="mt-4 rounded-xl bg-base p-3 text-xs text-neutral/80 sm:text-sm">
        <p className="mb-2 font-semibold text-neutral">Role: {role.toUpperCase()}</p>
      </div>
    </div>
  );
}
