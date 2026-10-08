import { redirect } from "next/navigation";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import ConfigurationClient from "@/components/admin/ConfigurationClient";

export default async function ConfigurationPage() {
  if (!(await requireAdminStaff())) redirect("/admin");
  return <ConfigurationClient />;
}
