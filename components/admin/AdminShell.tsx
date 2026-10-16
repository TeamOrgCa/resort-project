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
      <div className="admin-shell-grid admin-workspace">
        <aside className="admin-shell-sidebar hidden lg:block">
          <AdminSidebar role={role} permissions={permissions} />
        </aside>

        <main className="min-w-0">
          <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-neutral/10 bg-base px-4 py-3 shadow-sm md:px-8">
            <div className="lg:hidden">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-neutral/20 bg-white text-neutral hover:bg-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label="Open admin navigation"
                title="Open admin navigation"
                aria-expanded={isSidebarOpen}
                aria-controls="mobile-admin-navigation"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-6 w-6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            </div>
            <div className="ml-auto">
              <AdminNotifications role={role} />
            </div>
          </div>

          <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-8 md:py-8">{children}</div>
        </main>

        {isSidebarOpen ? (
          <div id="mobile-admin-navigation" className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
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
                  className="rounded-xl border border-white/20 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
                >
                  Close
                </button>
              </div>
              <AdminSidebar role={role} permissions={permissions} onNavigate={() => setIsSidebarOpen(false)} />
            </aside>
          </div>
        ) : null}
      </div>
    </SettingsProvider>
  );
}
