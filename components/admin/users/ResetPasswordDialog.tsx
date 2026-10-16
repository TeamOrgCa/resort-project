"use client";

import { useEffect, useState } from "react";

import StaffDialogShell from "@/components/admin/users/StaffDialogShell";

interface ResetPasswordDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  error: string;
  staffEmail: string | null;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void> | void;
}

export default function ResetPasswordDialog({
  isOpen,
  isSubmitting,
  error,
  staffEmail,
  onClose,
  onSubmit,
}: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isOpen) {
      setPassword("");
    }
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit(password);
  };

  return (
    <StaffDialogShell
      isOpen={isOpen}
      busy={isSubmitting}
      title="Reset Password"
      description={staffEmail ? `Set a new temporary password for ${staffEmail}.` : "Set a new temporary password."}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <label className="space-y-2">
          <span className="block text-sm font-medium text-neutral">Temporary Password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
            className="admin-field w-full"
            placeholder="At least 8 characters"
          />
        </label>

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
            {isSubmitting ? "Updating..." : "Reset Password"}
          </button>
        </div>
      </form>
    </StaffDialogShell>
  );
}