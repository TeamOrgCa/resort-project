"use client";

import StaffDialogShell from "@/components/admin/users/StaffDialogShell";

interface ResetPasswordDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  error: string;
  staffEmail: string | null;
  onClose: () => void;
  onSubmit: () => Promise<void> | void;
}

export default function ResetPasswordDialog({
  isOpen,
  isSubmitting,
  error,
  staffEmail,
  onClose,
  onSubmit,
}: ResetPasswordDialogProps) {
  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isSubmitting) await onSubmit();
  };

  return (
    <StaffDialogShell
      isOpen={isOpen}
      busy={isSubmitting}
      title="Reset Password"
      description={staffEmail ? `Generate a temporary password for ${staffEmail}.` : "Generate a temporary password."}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error ? <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

        <p className="text-sm text-neutral/70">A temporary password will be generated automatically and shown after the reset. The account holder must change it at their next sign-in.</p>

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
