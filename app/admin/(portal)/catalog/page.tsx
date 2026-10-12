import { redirect } from "next/navigation";
import { requireAdminStaff } from "@/lib/server/admin-audit";
import CatalogClient from "@/components/admin/catalog/CatalogClient";

export default async function CatalogPage() {
  if (!(await requireAdminStaff())) redirect("/admin");
  return <CatalogClient />;
}
