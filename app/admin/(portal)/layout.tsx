import type { ReactNode } from "react";
import AdminSidebar from "@/components/admin/AdminSidebar";

export default function AdminPortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-base px-4 py-6 md:px-6">
      <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[280px_1fr]">
        <aside>
          <AdminSidebar />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
