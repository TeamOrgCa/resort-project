"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminNotifications from "@/components/admin/AdminNotifications";

interface AdminShellProps {
  children: ReactNode;
}

export default function AdminShell({ children }: AdminShellProps) {
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
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex items-center gap-3">
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
          <AdminNotifications />
        </div>
      </div>

      <div className="md:grid md:gap-6 md:grid-cols-[280px_1fr]">
        <aside className="hidden md:block">
          <AdminSidebar />
        </aside>

        <main>{children}</main>
      </div>

      {isSidebarOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Admin navigation">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(false)}
            className="absolute inset-0 bg-neutral/40"
            aria-label="Close admin navigation"
          />
          <aside className="relative h-full w-[86%] max-w-xs overflow-y-auto bg-white p-3 shadow-xl">
            <div className="mb-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
              >
                Close
              </button>
            </div>
            <AdminSidebar />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
