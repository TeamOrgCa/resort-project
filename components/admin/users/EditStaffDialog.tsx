"use client";

import { useEffect, useState } from "react";

import StaffDialogShell from "@/components/admin/users/StaffDialogShell";
import type { StaffRole } from "@/lib/auth/staff-auth";

interface StaffUserSnapshot {
  id: string;
  full_name: string;
  email: string;
  role: StaffRole;
  is_active: boolean;
}

interface EditStaffDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  error: string;
  staffUser: StaffUserSnapshot | null;
  currentStaffUserId: string;
  onClose: () => void;
  onSubmit: (values: { fullName: string; role: StaffRole; isActive: boolean }) => Promise<void> | void;
}

const roleOptions: StaffRole[] = ["admin", "staff", "cashier"];

export default function EditStaffDialog({
  isOpen,
  isSubmitting,
  error,
  staffUser,
  currentStaffUserId,
  onClose,
  onSubmit,
}: EditStaffDialogProps) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [isActive, setIsActive] = useState(true);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen || !staffUser) {
      return;
    }

    setFullName(staffUser.full_name);
    setRole(staffUser.role);
    setIsActive(staffUser.is_active);
  }, [isOpen, staffUser]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!staffUser) {
    return null;
  }

  const isCurrentUser = staffUser.id === currentStaffUserId;
  const isAdminAccount = staffUser.role === "admin";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await onSubmit({
      fullName: fullName.trim(),
      role: isAdminAccount ? staffUser.role : role,
      isActive: isAdminAccount && staffUser.is_active ? true : isActive,
    });
  };

  return (
    <StaffDialogShell
      isOpen={isOpen}
      busy={isSubmitting}
      title="Edit Staff User"
      description={`Update access and profile details for ${staffUser.email}.`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Full Name</span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              className="admin-field w-full"
            />
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as StaffRole)}
              disabled={isSubmitting || isCurrentUser || isAdminAccount}
              className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 focus:border-primary focus:outline-none disabled:bg-base"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "staff" ? "Manager" : option === "admin" ? "Admin" : "Cashier"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-neutral/10 bg-base px-4 py-3 text-sm text-neutral">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            disabled={isSubmitting || (isAdminAccount && staffUser.is_active)}
            className="h-4 w-4 rounded border-neutral/30"
          />
          Active account
        </label>

        {isAdminAccount ? (
          <p className="text-xs text-neutral/60">Admin accounts cannot be disabled or have their admin role removed.</p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-neutral/10 pt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-xl border border-neutral/20 px-4 py-2.5 text-sm font-semibold text-neutral hover:bg-base disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </StaffDialogShell>
  );
}
