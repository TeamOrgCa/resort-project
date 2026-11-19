"use client";

import { useEffect, useState } from "react";

import StaffDialogShell from "@/components/admin/users/StaffDialogShell";
import type { StaffRole } from "@/lib/auth/staff-auth";
import { normalizePersonName, sanitizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";
import { isValidStaffEmailForRole } from "@/lib/auth/staff-email";

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
  const [nameError, setNameError] = useState("");
  const [roleError, setRoleError] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen || !staffUser) {
      return;
    }

    setFullName(staffUser.full_name);
    setNameError("");
    setRoleError("");
    setRole(staffUser.role);
    setIsActive(staffUser.is_active);
  }, [isOpen, staffUser]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!staffUser) {
    return null;
  }

  const isCurrentUser = staffUser.id === currentStaffUserId;
  const isAdminAccount = staffUser.role === "admin";
  const isOtherAdmin = isAdminAccount && !isCurrentUser;
  const canPromoteToAdmin = isValidStaffEmailForRole(staffUser.email, "admin");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    if (!isAdminAccount && role === "admin" && !canPromoteToAdmin) {
      setRoleError("Only accounts using @gmail.com can be promoted to Admin.");
      return;
    }
    const normalizedName = normalizePersonName(isOtherAdmin ? staffUser.full_name : fullName);
    if (!normalizedName) { setNameError(PERSON_NAME_ERROR); return; }
    setNameError("");

    await onSubmit({
      fullName: isOtherAdmin ? staffUser.full_name : normalizedName,
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
        {nameError && <p role="alert" className="text-sm text-red-700">{nameError}</p>}
        {roleError && <p role="alert" className="text-sm text-red-700">{roleError}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Full Name</span>
            <input
              value={fullName}
              onChange={(event) => { setFullName(sanitizePersonName(event.target.value)); setNameError(""); }}
              autoComplete="name"
              maxLength={100}
              disabled={isSubmitting || isOtherAdmin}
              required
              className="admin-field w-full"
            />
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Role</span>
            <select
              value={role}
              onChange={(event) => { setRole(event.target.value as StaffRole); setRoleError(""); }}
              disabled={isSubmitting || isCurrentUser || isAdminAccount}
              className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 focus:border-primary focus:outline-none disabled:bg-base"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option} disabled={option === "admin" && !isAdminAccount && !canPromoteToAdmin}>
                  {option === "staff" ? "Manager" : option === "admin" ? "Admin" : "Cashier"}
                </option>
              ))}
            </select>
            {!isAdminAccount && !canPromoteToAdmin && <span className="block text-xs text-neutral/60">Admin access requires a @gmail.com account for email-code verification.</span>}
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
          <p className="text-xs text-neutral/60">Admin accounts cannot be disabled or have their admin role removed. {isOtherAdmin ? "Only the account owner can change this admin's name." : "You can update your own name."}</p>
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
            disabled={isSubmitting || (isOtherAdmin && staffUser.is_active)}
            className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </StaffDialogShell>
  );
}
