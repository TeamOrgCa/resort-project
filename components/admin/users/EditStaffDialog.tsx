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

  useEffect(() => {
    if (!isOpen || !staffUser) {
      return;
    }

    setFullName(staffUser.full_name);
    setRole(staffUser.role);
    setIsActive(staffUser.is_active);
  }, [isOpen, staffUser]);

  if (!staffUser) {
    return null;
  }

  const isCurrentUser = staffUser.id === currentStaffUserId;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await onSubmit({
      fullName: fullName.trim(),
      role,
      isActive,
    });
  };

  return (
    <StaffDialogShell
      isOpen={isOpen}
      title="Edit Staff User"
      description={`Update access and profile details for ${staffUser.email}.`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Full Name</span>
            <input
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 focus:border-primary focus:outline-none"
            />
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as StaffRole)}
              disabled={isCurrentUser}
              className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 focus:border-primary focus:outline-none disabled:bg-base"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
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
            disabled={isCurrentUser && isActive && role === "admin"}
            className="h-4 w-4 rounded border-neutral/30"
          />
          Active account
        </label>

        {isCurrentUser ? (
          <p className="text-xs text-neutral/60">Your own admin role cannot be removed.</p>
        ) : null}

        <div className="flex items-center justify-end gap-3 pt-2">
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
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-base hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </StaffDialogShell>
  );
}