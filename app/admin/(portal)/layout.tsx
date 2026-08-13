import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import { requireActiveStaff } from "@/lib/server/admin-audit";

export default async function AdminPortalLayout({ children }: { children: ReactNode }) {
  const staffContext = await requireActiveStaff();

  if (!staffContext) {
    redirect("/staff/login");
  }

  return (
    <div className="min-h-screen bg-base px-4 py-6 md:px-6">
      <AdminShell role={staffContext.staffUser.role}>{children}</AdminShell>
    </div>
  );
}
