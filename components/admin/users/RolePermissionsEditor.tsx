"use client";

import { useEffect, useRef, useState } from "react";
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from "@/lib/auth/role-access";

type EditableRole = "staff" | "cashier";
export default function RolePermissionsEditor() {
  const [grants, setGrants] = useState<Record<EditableRole, string[]>>({ staff: [], cashier: [] });
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
      setGrants({ staff: data.roles.find((row: { role: string }) => row.role === "staff")?.permissions ?? [], cashier: data.roles.find((row: { role: string }) => row.role === "cashier")?.permissions ?? [] });
    }).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, []);
  const toggle = (role: EditableRole, permission: Permission) => {
    setGrants((current) => ({ ...current, [role]: current[role].includes(permission) ? current[role].filter((item) => item !== permission) : [...current[role], permission] }));
    setMessage("");
  };
  const save = async () => {
    if (submitting.current || !loaded) return;
    submitting.current = true;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/permissions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roles: (["staff", "cashier"] as const).map(role => ({ role, permissions: grants[role] })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to save permissions.");
      setMessage("Role permissions saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save permissions."); }
    finally { submitting.current = false; setSaving(false); }
  };
  if (loading) return <p>Loading permissions...</p>;
  return <div className="space-y-5">
    <p className="text-sm leading-relaxed text-neutral/65">Choose which modules and actions each role can access, then save your changes. Administrators retain full access.</p>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">{message}</p>}
    <div className="overflow-x-auto rounded-xl border border-neutral/10"><table className="w-full min-w-0 text-left text-xs sm:min-w-[550px] sm:text-sm"><thead className="border-b border-neutral/10 bg-base/60 text-neutral/60"><tr><th className="px-2 py-3 sm:px-4">Permission</th><th className="px-1 py-3 sm:px-4">Manager</th><th className="px-1 py-3 sm:px-4">Cashier</th><th className="px-1 py-3 sm:px-4">Admin</th></tr></thead><tbody>
      {PERMISSIONS.map((permission) => <tr key={permission} className="border-t border-neutral/10 hover:bg-base/40"><th className="px-2 py-3 font-medium text-neutral sm:px-4">{PERMISSION_LABELS[permission]}</th>{(["staff", "cashier"] as const).map((role) => <td key={role} className="px-1 py-1 sm:px-4"><label className="flex h-11 w-11 items-center justify-center"><input aria-label={`${role === "staff" ? "Manager" : "Cashier"}: ${PERMISSION_LABELS[permission]}`} type="checkbox" disabled={saving || !loaded || ["users", "configuration", "catalog"].includes(permission)} checked={grants[role].includes(permission)} onChange={() => toggle(role, permission)} /></label></td>)}<td className="px-1 py-3 text-center sm:px-4">✓</td></tr>)}
    </tbody></table></div>
    <div className="flex justify-end border-t border-neutral/10 pt-5"><button type="button" disabled={saving || !loaded} onClick={() => void save()} className="admin-button-primary">{saving ? "Saving..." : "Save permissions"}</button></div>
  </div>;
}
