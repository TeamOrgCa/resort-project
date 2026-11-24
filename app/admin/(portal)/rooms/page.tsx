import { redirect } from "next/navigation";
import RoomManagement from "@/components/admin/rooms/RoomManagement";
import { requireActiveStaff } from "@/lib/server/admin-audit";
import { getRolePermissions } from "@/lib/server/role-permissions";
import { hasPermission } from "@/lib/auth/role-access";

export default async function RoomsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireActiveStaff();
  if (!staff) redirect("/staff/login");
  const permissions = await getRolePermissions(staff.supabase, staff.staffUser.role);
  if (!hasPermission(staff.staffUser.role, permissions, "rooms")) redirect("/staff/no-access");
  const params = await searchParams;
  return <RoomManagement role={staff.staffUser.role} permissions={permissions} initialCategory={typeof params.category === "string" ? params.category : null} initialPanel={typeof params.panel === "string" ? params.panel : null} />;
}
