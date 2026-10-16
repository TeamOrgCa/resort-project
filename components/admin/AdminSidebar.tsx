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
  onNavigate?: () => void;
}

export default function AdminSidebar({ role, permissions, onNavigate }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = async () => {
    const supabase = createClient();
    await fetch("/api/admin/auth/logout", { method: "POST" });
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/staff/login");
  };

  // Filter navigation based on role
  const filteredNavigation = filterNavigationByRole(adminNavigation, role, permissions);

  return (
    <div className="h-full overflow-y-auto border-r border-white/10 text-white" style={{ backgroundColor: "#2D1B12" }}>
      <div className="flex min-h-full flex-col px-4 py-5">
        <div className="mb-5 border-b border-white/10 px-3 pb-5">
          <p className="text-lg font-semibold tracking-tight text-white">MarVille Admin</p>
          <p className="mt-1 text-xs text-white/50">Resort management</p>
        </div>

        <nav aria-label="Admin modules" className="flex-1 space-y-1">
          {filteredNavigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={`block min-h-11 rounded-xl px-4 py-2.5 transition-colors duration-200 ${
                isActive
                  ? "bg-primary text-white shadow-sm"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              }`}
              >
                <p className="text-sm font-medium">{item.label}</p>
                <p className={`mt-0.5 text-[11px] leading-relaxed ${isActive ? "text-white/80" : "text-white/45"}`}>{item.description}</p>
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={handleLogout}
          className="mt-5 min-h-11 w-full rounded-xl border border-white/15 px-4 py-2.5 text-left text-sm font-medium text-white/80 transition-colors hover:bg-white/10 hover:text-white"
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
