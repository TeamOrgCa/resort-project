"use client";

import { useEffect, useId, useRef, useState } from "react";

import StaffDialogShell from "@/components/admin/users/StaffDialogShell";
import type { StaffUserFormValues } from "@/components/admin/users/types";
import type { StaffRole } from "@/lib/auth/staff-auth";
import { isValidStaffEmail, STAFF_EMAIL_ERROR } from "@/lib/auth/staff-email";

interface CreateStaffDialogProps {
  isOpen: boolean;
  isSubmitting: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (values: StaffUserFormValues) => Promise<void> | void;
}

const roleOptions: StaffRole[] = ["admin", "staff", "cashier"];

export default function CreateStaffDialog({ isOpen, isSubmitting, error, onClose, onSubmit }: CreateStaffDialogProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("staff");
  const [password, setPassword] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [emailError, setEmailError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const emailHelpId = useId();

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFullName("");
    setEmail("");
    setRole("staff");
    setPassword("");
    setIsActive(true);
    setEmailError("");
  }, [isOpen]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidStaffEmail(normalizedEmail)) {
      setEmailError(STAFF_EMAIL_ERROR);
      emailInput.current?.focus();
      return;
    }
    setEmailError("");

    await onSubmit({
      fullName: fullName.trim(),
      email: normalizedEmail,
      role,
      password,
      isActive,
    });
  };

  return (
    <StaffDialogShell
      isOpen={isOpen}
      busy={isSubmitting}
      title="Create Staff User"
      description="Create a staff account and choose its access level."
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
              placeholder="Alex Mendoza"
            />
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Email</span>
            <input
              type="email"
              ref={emailInput}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (emailError) setEmailError(isValidStaffEmail(event.target.value.trim()) ? "" : STAFF_EMAIL_ERROR);
              }}
              onBlur={() => {
                const normalizedEmail = email.trim().toLowerCase();
                setEmail(normalizedEmail);
                setEmailError(normalizedEmail && !isValidStaffEmail(normalizedEmail) ? STAFF_EMAIL_ERROR : "");
              }}
              onInvalid={(event) => { event.preventDefault(); setEmailError(STAFF_EMAIL_ERROR); emailInput.current?.focus(); }}
              required
              maxLength={254}
              autoComplete="email"
              inputMode="email"
              aria-invalid={Boolean(emailError)}
              aria-describedby={emailHelpId}
              className={`w-full rounded-xl border px-3 py-2.5 text-black focus:border-primary focus:outline-none ${emailError ? "border-red-500" : "border-neutral/20"}`}
              placeholder="alex@example.com"
            />
            <span id={emailHelpId} role={emailError ? "alert" : undefined} className={`block text-xs ${emailError ? "text-red-700" : "text-neutral/60"}`}>
              {emailError || "Use a complete email address, including its domain, such as alex@example.com."}
            </span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as StaffRole)}
              className="admin-field w-full"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "staff" ? "Manager" : option === "admin" ? "Admin" : "Cashier"}
                </option>
              ))}
            </select>
          </label>

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
        </div>

        <label className="flex items-center gap-3 rounded-xl border border-neutral/10 bg-base px-4 py-3 text-sm text-neutral">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 rounded border-neutral/30"
          />
          Create as active staff member
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
            {isSubmitting ? "Creating..." : "Create Staff User"}
          </button>
        </div>
      </form>
    </StaffDialogShell>
  );
}
