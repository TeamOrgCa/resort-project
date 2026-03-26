import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/admin/AdminSidebar";
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
      <div className="mx-auto grid max-w-7xl gap-6 md:grid-cols-[280px_1fr]">
        <aside>
          <AdminSidebar />
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
