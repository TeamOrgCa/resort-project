"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminNotifications from "@/components/admin/AdminNotifications";
import { SettingsProvider } from "@/components/settings/SettingsProvider";
import type { StaffRole } from "@/lib/auth/staff-auth";

interface AdminShellProps {
  children: ReactNode;
  role: StaffRole;
  permissions: string[];
}

export default function AdminShell({ children, role, permissions }: AdminShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    if (!isSidebarOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isSidebarOpen]);

  useEffect(() => {
    document.body.style.overflow = isSidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isSidebarOpen]);

  return (
    <SettingsProvider>
      <div className="admin-shell-grid">
        <aside className="admin-shell-sidebar hidden md:block">
          <AdminSidebar role={role} permissions={permissions} />
        </aside>

        <main className="min-w-0">
          <div className="flex items-center gap-3 border-b border-neutral/10 px-4 py-3 md:px-8">
            <div className="md:hidden">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="rounded-lg border border-neutral/20 bg-white px-4 py-2 text-sm font-semibold text-neutral hover:bg-base"
                aria-label="Open admin navigation"
                aria-expanded={isSidebarOpen}
              >
                Menu
              </button>
            </div>
            <div className="ml-auto">
              <AdminNotifications role={role} />
            </div>
          </div>

          <div className="px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>

        {isSidebarOpen ? (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="absolute inset-0 bg-neutral/40"
              aria-label="Close admin navigation"
            />
            <aside className="relative h-full w-[min(86vw,320px)] border-r border-neutral/10 bg-[#2B1B12]">
              <div className="absolute right-4 top-4 z-10">
                <button
                  type="button"
                  onClick={() => setIsSidebarOpen(false)}
                  className="rounded-lg border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
                >
                  Close
                </button>
              </div>
              <AdminSidebar role={role} permissions={permissions} />
            </aside>
          </div>
        ) : null}
      </div>
    </SettingsProvider>
  );
}
