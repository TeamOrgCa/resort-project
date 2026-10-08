"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { adminNavigation } from "@/components/admin/content";
import { filterNavigationByRole } from "@/lib/auth/role-access";
import { createClient } from "@/lib/supabase/client";
import type { StaffRole } from "@/lib/auth/staff-auth";

interface AdminSidebarProps {
  role: StaffRole;
  permissions: string[];
}

export default function AdminSidebar({ role, permissions }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await fetch("/api/admin/auth/logout", { method: "POST" });
    await supabase.auth.signOut();
    router.replace("/staff/login");
  };

  // Filter navigation based on role
  const filteredNavigation = filterNavigationByRole(adminNavigation, role, permissions);

  return (
    <div className="h-full border-r border-white/10 text-white" style={{ backgroundColor: "#2D1B12" }}>
      <div className="flex h-full flex-col px-4 py-4">
        <div className="mb-4 border-b border-white/10 pb-3">
          <p className="text-sm font-semibold text-primary">MarVille Admin</p>
        </div>

        <nav className="flex-1 space-y-0.5">
          {filteredNavigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-xl px-4 py-2 transition-all duration-200 ${
                isActive
                  ? "bg-primary text-white shadow-sm"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
              >
                <p className="font-semibold">{item.label}</p>
                <p className="text-[11px] text-white/50">{item.description}</p>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-5 w-full border border-white/15 px-3 py-2 text-left text-sm font-semibold text-white/80 hover:bg-white/10 hover:text-white"
        >
          Log out
        </button>

        <div className="mt-4 border-t border-white/10 pt-4 text-xs text-white/60 sm:text-sm">
          <p className="font-semibold text-white/80">Role: {role === "staff" ? "MANAGER" : role.toUpperCase()}</p>
        </div>
      </div>
    </div>
  );
}
