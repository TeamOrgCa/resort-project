"use client";

import { useEffect, useMemo, useState } from "react";

import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTablePreview from "@/components/admin/AdminTablePreview";
import {
  permissionColumns,
  permissionRows,
  usersColumns,
} from "@/components/admin/content";
import CreateStaffDialog from "@/components/admin/users/CreateStaffDialog";
import EditStaffDialog from "@/components/admin/users/EditStaffDialog";
import ResetPasswordDialog from "@/components/admin/users/ResetPasswordDialog";
import type { StaffUserFormValues, StaffUserTableRow } from "@/components/admin/users/types";
import type { StaffRole } from "@/lib/auth/staff-auth";

const userTabs = ["Staff Accounts", "Role Permission Matrix"] as const;

type StaffUserRecord = {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

export default function AdminUsersPage() {
  const [activeTab, setActiveTab] = useState<(typeof userTabs)[number]>("Staff Accounts");
  const [rows, setRows] = useState<StaffUserRecord[]>([]);
  const [currentStaffUserId, setCurrentStaffUserId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffUserRecord | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editError, setEditError] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [isResettingPassword, setIsResettingPassword] = useState(false);

  useEffect(() => {
    const loadStaffUsers = async () => {
      setIsLoading(true);
      setPageError("");

      try {
        const response = await fetch("/api/admin/users", { cache: "no-store" });
        const data = await response.json();

        if (!response.ok || !data.success) {
          setPageError(data.message || "Unable to load staff accounts.");
          return;
        }

        setRows((data.rows as StaffUserRecord[]) ?? []);
        setCurrentStaffUserId(data.currentStaffUserId ?? "");
      } catch {
        setPageError("Unable to connect to the server.");
      } finally {
        setIsLoading(false);
      }
    };

    loadStaffUsers();
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const tableRows: StaffUserTableRow[] = useMemo(
    () =>
      rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        role: row.role,
        status: row.is_active ? "Active" : "Inactive",
        lastLogin: row.last_login_at ? new Date(row.last_login_at).toLocaleString("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
        }) : "Never",
        createdAt: new Date(row.created_at).toLocaleString("en-PH", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
      })),
    [rows]
  );

  const selectedStaffDisplay = selectedStaff
    ? {
        id: selectedStaff.id,
        full_name: selectedStaff.full_name,
        email: selectedStaff.email,
        role: selectedStaff.role,
        is_active: selectedStaff.is_active,
      }
    : null;

  const refreshRows = async () => {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const data = await response.json();

    if (response.ok && data.success) {
      setRows((data.rows as StaffUserRecord[]) ?? []);
      setCurrentStaffUserId(data.currentStaffUserId ?? "");
    }
  };

  const showToast = (tone: "success" | "error", message: string) => {
    setToast({ tone, message });
  };

  const handleCreateStaff = async (values: StaffUserFormValues) => {
    setCreateError("");
    setIsCreating(true);

    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setCreateError(data.message || "Unable to create staff user.");
        return;
      }

      setIsCreateOpen(false);
      showToast("success", data.message || "Staff user created.");
      await refreshRows();
    } catch {
      setCreateError("Unable to connect to the server.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleEditStaff = async (values: { fullName: string; role: StaffRole; isActive: boolean }) => {
    if (!selectedStaff) {
      return;
    }

    setEditError("");
    setIsEditing(true);

    try {
      const response = await fetch(`/api/admin/users/${selectedStaff.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setEditError(data.message || "Unable to update staff user.");
        return;
      }

      setIsEditOpen(false);
      setSelectedStaff(null);
      showToast("success", data.message || "Staff user updated.");
      await refreshRows();
    } catch {
      setEditError("Unable to connect to the server.");
    } finally {
      setIsEditing(false);
    }
  };

  const handleResetPassword = async (password: string) => {
    if (!selectedStaff) {
      return;
    }

    setPasswordError("");
    setIsResettingPassword(true);

    try {
      const response = await fetch(`/api/admin/users/${selectedStaff.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setPasswordError(data.message || "Unable to reset password.");
        return;
      }

      setIsPasswordOpen(false);
      setSelectedStaff(null);
      showToast("success", data.message || "Password reset successfully.");
      await refreshRows();
    } catch {
      setPasswordError("Unable to connect to the server.");
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleRowAction = async (action: string, row: StaffUserTableRow) => {
    const staffRecord = rows.find((item) => item.id === row.id);

    if (!staffRecord) {
      return;
    }

    if (action === "Edit") {
      setSelectedStaff(staffRecord);
      setEditError("");
      setIsEditOpen(true);
      return;
    }

    if (action === "Reset Password") {
      setSelectedStaff(staffRecord);
      setPasswordError("");
      setIsPasswordOpen(true);
      return;
    }

    if (action === "Toggle Status") {
      setEditError("");
      setSelectedStaff(staffRecord);
      setIsEditing(true);

      try {
        const response = await fetch(`/api/admin/users/${staffRecord.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: staffRecord.full_name,
            role: staffRecord.role,
            isActive: !staffRecord.is_active,
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
          showToast("error", data.message || "Unable to update staff status.");
          return;
        }

        showToast("success", data.message || "Staff status updated.");
        await refreshRows();
      } catch {
        showToast("error", "Unable to connect to the server.");
      } finally {
        setIsEditing(false);
      }
    }
  };

  return (
    <div>
      <AdminSectionHeader
        title="User Management and Access Control"
        subtitle="Manage staff accounts, assign roles, and enforce access-level boundaries."
      />

      {toast ? (
        <div
          className={`mb-4 rounded-2xl border px-4 py-3 text-sm font-medium ${
            toast.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {toast.message}
        </div>
      ) : null}

      <section className="rounded-2xl border border-neutral/10 bg-white p-4">
        <div className="mb-4 flex flex-wrap gap-2 border-b border-neutral/10 pb-4">
          {userTabs.map((tab) => {
            const isActive = tab === activeTab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  isActive ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {pageError ? <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</div> : null}

        {activeTab === "Staff Accounts" && (
          <AdminTablePreview
            title="Staff Accounts"
            columns={usersColumns}
            rows={tableRows}
            defaultSort={{ key: "createdAt", direction: "desc" }}
            filters={[
              { key: "role", label: "Role", options: ["admin", "staff", "cashier"] },
              { key: "status", label: "Status", options: ["Active", "Inactive"] },
            ]}
            actions={["Add Staff User"]}
            onAction={() => setIsCreateOpen(true)}
            rowActions={["Edit", "Toggle Status", "Reset Password"]}
            getRowActionLabel={(action, row) => (action === "Toggle Status" ? (row.status === "Active" ? "Disable" : "Enable") : action)}
            onRowAction={handleRowAction}
            sortable
          />
        )}

        {activeTab === "Role Permission Matrix" && (
          <AdminTablePreview
            title="Role Permission Matrix"
            columns={permissionColumns}
            rows={permissionRows}
            enableSearch={false}
            sortable={false}
            actions={[]}
          />
        )}
      </section>

      <CreateStaffDialog
        isOpen={isCreateOpen}
        isSubmitting={isCreating}
        error={createError}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={handleCreateStaff}
      />

      <EditStaffDialog
        isOpen={isEditOpen}
        isSubmitting={isEditing}
        error={editError}
        staffUser={selectedStaffDisplay}
        currentStaffUserId={currentStaffUserId}
        onClose={() => {
          setIsEditOpen(false);
          setSelectedStaff(null);
          setEditError("");
        }}
        onSubmit={handleEditStaff}
      />

      <ResetPasswordDialog
        isOpen={isPasswordOpen}
        isSubmitting={isResettingPassword}
        error={passwordError}
        staffEmail={selectedStaff?.email ?? null}
        onClose={() => {
          setIsPasswordOpen(false);
          setSelectedStaff(null);
          setPasswordError("");
        }}
        onSubmit={handleResetPassword}
      />

      {isLoading ? (
        <div className="mt-4 text-sm text-neutral/70">Loading staff accounts...</div>
      ) : null}
    </div>
  );
}