"use client";

import TablePagination from "@/components/admin/TablePagination";
import { AdminTableSkeleton } from "@/components/admin/AdminSkeletons";
import { useEffect, useRef, useState } from "react";
import { PERMISSIONS, PERMISSION_LABELS, hasPermission, isPermissionAssignable, type Permission } from "@/lib/auth/role-access";
import { useActionConfirmation } from "@/components/ui/use-action-confirmation";

type EditableRole = "staff" | "cashier";
export default function RolePermissionsEditor() {
  const [grants, setGrants] = useState<Record<EditableRole, string[]>>({ staff: [], cashier: [] });
  const [savedGrants, setSavedGrants] = useState<Record<EditableRole, string[]>>({ staff: [], cashier: [] });
  const { confirm, confirmation } = useActionConfirmation();
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    fetch("/api/admin/permissions", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to load permissions.");
      setLoaded(true);
      const loadedGrants = Object.fromEntries((["staff", "cashier"] as const).map(role => [role, PERMISSIONS.filter(permission =>
        hasPermission(role, data.roles.find((row: { role: string }) => row.role === role)?.permissions ?? [], permission))])) as Record<EditableRole, string[]>;
      setGrants(loadedGrants); setSavedGrants(loadedGrants);
    }).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, []);
  const toggle = (role: EditableRole, permission: Permission) => {
    setGrants((current) => ({ ...current, [role]: current[role].includes(permission) ? current[role].filter((item) => item !== permission) : [...current[role], permission] }));
    setMessage("");
  };
  const save = async () => {
    if (submitting.current || !loaded) return;
    const changes = (["staff", "cashier"] as const).map(role => {
      const added = grants[role].filter(value => !savedGrants[role].includes(value));
      const removed = savedGrants[role].filter(value => !grants[role].includes(value));
      return `${role === "staff" ? "Manager" : "Cashier"}:\n${added.length ? `Allow: ${added.map(value => PERMISSION_LABELS[value as Permission]).join(", ")}\n` : ""}${removed.length ? `Remove: ${removed.map(value => PERMISSION_LABELS[value as Permission]).join(", ")}` : ""}${!added.length && !removed.length ? "No changes" : ""}`;
    }).join("\n\n");
    if (!await confirm({ title: "Save role permissions?", confirmText: "Confirm save permissions", message: `${changes}\n\nThese permissions apply to every Manager and Cashier account. Save this access configuration?` })) return;
    if (submitting.current) return;
    submitting.current = true;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/permissions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles: (["staff", "cashier"] as const).map(role => ({ role, permissions: grants[role] })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to save permissions.");
      setMessage("Role permissions saved.");
      setSavedGrants(grants);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save permissions."); }
    finally { submitting.current = false; setSaving(false); }
  };
  if (loading) return <AdminTableSkeleton label="Loading permissions..." columns={["Permission", "Manager", "Cashier", "Admin"]} rows={8} />;
  return <div className="space-y-5">
    {confirmation}
    <p className="text-sm leading-relaxed text-neutral/65">Choose which modules and actions each role can access, then save your changes. Administrators have full access to Users, Configuration and Business Catalog. They can view other modules, export and print Reports and Analytics, and export Audit logs. Managers approve refunds and verify transfers; cashiers record approved payouts.</p>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</p>}
    <div className="overflow-x-auto rounded-xl border border-neutral/10"><table className="record-table w-full min-w-[550px] text-left text-xs sm:min-w-[550px] sm:text-sm"><thead className="border-b border-neutral/10 bg-base/60 text-neutral/60"><tr><th className="px-2 py-3 sm:px-4">Permission</th><th className="px-1 py-3 sm:px-4">Manager</th><th className="px-1 py-3 sm:px-4">Cashier</th><th className="px-1 py-3 sm:px-4">Admin</th></tr></thead><tbody>
      {PERMISSIONS.slice(page * 25, (page + 1) * 25).map((permission) => <tr key={permission} className="border-t border-neutral/10 hover:bg-base/40"><th className="table-cell-text px-2 py-3 font-medium text-neutral sm:px-4">{PERMISSION_LABELS[permission]}</th>{(["staff", "cashier"] as const).map((role) => <td key={role} className="px-1 py-1 sm:px-4"><label className="flex h-11 w-11 items-center justify-center"><input aria-label={`${role === "staff" ? "Manager" : "Cashier"}: ${PERMISSION_LABELS[permission]}`} type="checkbox" disabled={saving || !loaded || !isPermissionAssignable(role, permission)} checked={hasPermission(role, grants[role], permission)} onChange={() => toggle(role, permission)} /></label></td>)}<td className="px-1 py-3 text-center sm:px-4">{["users", "configuration", "catalog"].includes(permission) ? "Full access" : hasPermission("admin", [], permission) ? "View only" : "Unavailable"}</td></tr>)}
    </tbody></table></div>
    <TablePagination total={PERMISSIONS.length} page={page} pageSize={25} onPageChange={setPage} disabled={saving} label="Role permissions pagination" />
    <div className="flex justify-end border-t border-neutral/10 pt-5"><button type="button" disabled={saving || !loaded} onClick={() => void save()} className="admin-button-primary">{saving ? "Saving..." : "Save permissions"}</button></div>
  </div>;
}
