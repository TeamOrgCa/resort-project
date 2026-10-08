"use client";

import { useEffect, useState } from "react";
import { PERMISSIONS, PERMISSION_LABELS, type Permission } from "@/lib/auth/role-access";

type EditableRole = "staff" | "cashier";
export default function RolePermissionsEditor() {
  const [grants, setGrants] = useState<Record<EditableRole, string[]>>({ staff: [], cashier: [] });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EditableRole | null>(null);
  useEffect(() => {
    fetch("/api/admin/permissions", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to load permissions.");
      setGrants({ staff: data.roles.find((row: { role: string }) => row.role === "staff")?.permissions ?? [], cashier: data.roles.find((row: { role: string }) => row.role === "cashier")?.permissions ?? [] });
    }).catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, []);
  const toggle = (role: EditableRole, permission: Permission) => {
    setGrants((current) => ({ ...current, [role]: current[role].includes(permission) ? current[role].filter((item) => item !== permission) : [...current[role], permission] }));
    setMessage("");
  };
  const save = async (role: EditableRole) => {
    setSaving(role); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/permissions", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, permissions: grants[role] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message ?? "Unable to save permissions.");
      setMessage(`${role === "staff" ? "Manager" : "Cashier"} permissions saved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save permissions."); }
    finally { setSaving(null); }
  };
  if (loading) return <p>Loading permissions...</p>;
  return <div className="space-y-5">
    <p className="text-sm text-neutral/70">Changes take effect on the next request. Admin retains full access. Manager is stored as the existing staff role.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="text-sm text-green-700">{message}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[550px] text-left text-sm"><thead><tr><th className="p-2">Permission</th><th className="p-2">Manager</th><th className="p-2">Cashier</th><th className="p-2">Admin</th></tr></thead><tbody>
      {PERMISSIONS.map((permission) => <tr key={permission} className="border-t border-neutral/10"><th className="p-2 font-medium">{PERMISSION_LABELS[permission]}</th>{(["staff", "cashier"] as const).map((role) => <td key={role} className="p-2"><input aria-label={`${role === "staff" ? "Manager" : "Cashier"}: ${PERMISSION_LABELS[permission]}`} type="checkbox" disabled={["users", "configuration", "catalog"].includes(permission)} checked={grants[role].includes(permission)} onChange={() => toggle(role, permission)} /></td>)}<td className="p-2">✓</td></tr>)}
    </tbody></table></div>
    <div className="flex gap-3">{(["staff", "cashier"] as const).map((role) => <button key={role} type="button" disabled={saving !== null} onClick={() => save(role)} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">Save {role === "staff" ? "manager" : "cashier"}</button>)}</div>
  </div>;
}
