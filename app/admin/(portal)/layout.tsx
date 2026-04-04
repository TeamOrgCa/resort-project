import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";
import { createClient } from "@/lib/supabase/server";
import type { StaffUserProfile } from "@/lib/auth/staff-auth";

export default async function AdminPortalLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/admin/login");
  }

  const { data: staffUser, error: staffUserError } = await supabase
    .from("staff_users")
    .select("id, full_name, email, role, is_active")
    .eq("id", user.id)
    .maybeSingle<StaffUserProfile>();

  if (staffUserError || !staffUser || !staffUser.is_active) {
    redirect("/admin/login");
  }

  return (
    <div className="min-h-screen bg-base px-4 py-6 md:px-6">
      <AdminShell>{children}</AdminShell>
    </div>
  );
}
