"use client";

import { useEffect, useId, useRef, useState } from "react";

import StaffDialogShell from "@/components/admin/users/StaffDialogShell";
import PasswordInput from "@/components/ui/PasswordInput";
import type { StaffUserFormValues } from "@/components/admin/users/types";
import type { StaffRole } from "@/lib/auth/staff-auth";
import { isValidStaffEmailForRole, staffEmailError, staffEmailSuffix, staffEmailUsername } from "@/lib/auth/staff-email";
import { normalizePersonName, sanitizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";

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
  const [nameError, setNameError] = useState("");
  const emailInput = useRef<HTMLInputElement>(null);
  const emailHelpId = useId();
  const suffix = staffEmailSuffix(role);
  const emailMessage = staffEmailError(role);
  const fullEmail = `${email.trim().toLowerCase()}${suffix}`;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFullName("");
    setNameError("");
    setEmail("");
    setRole("staff");
    setPassword("");
    setIsActive(true);
    setEmailError("");
  }, [isOpen]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    const normalizedName = normalizePersonName(fullName);
    if (!normalizedName) { setNameError(PERSON_NAME_ERROR); return; }
    setNameError("");
    const normalizedEmail = fullEmail;
    if (!isValidStaffEmailForRole(normalizedEmail, role)) {
      setEmailError(emailMessage);
      emailInput.current?.focus();
      return;
    }
    setEmailError("");

    await onSubmit({
      fullName: normalizedName,
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
        {nameError && <p role="alert" className="text-sm text-red-700">{nameError}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Full Name</span>
            <input
              value={fullName}
              onChange={(event) => { setFullName(sanitizePersonName(event.target.value)); setNameError(""); }}
              autoComplete="name"
              maxLength={100}
              required
              className="admin-field w-full"
              placeholder="Alex Mendoza"
            />
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Email</span>
            <span className={`flex min-w-0 overflow-hidden rounded-xl border bg-white focus-within:border-primary ${emailError ? "border-red-500" : "border-neutral/20"}`}>
              <input
                type="text"
                aria-label="Email username"
                ref={emailInput}
                value={email}
                onKeyDown={(event) => { if (event.key === "@") event.preventDefault(); }}
                onBeforeInput={(event) => { if ((event.nativeEvent as InputEvent).data?.includes("@")) event.preventDefault(); }}
                onChange={(event) => {
                  if (event.target.value.includes("@")) return;
                  const username = staffEmailUsername(event.target.value, role);
                  setEmail(username);
                  if (emailError) setEmailError(isValidStaffEmailForRole(`${username}${suffix}`, role) ? "" : emailMessage);
                }}
                onBlur={() => {
                  const username = staffEmailUsername(email, role);
                  setEmail(username);
                  setEmailError(username && !isValidStaffEmailForRole(`${username}${suffix}`, role) ? emailMessage : "");
                }}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData("text");
                  const username = staffEmailUsername(pasted, role);
                  if (username.includes("@") || username.length > 64) {
                    event.preventDefault(); setEmail(""); setEmailError(emailMessage); return;
                  }
                  if (!pasted.includes("@")) return;
                  event.preventDefault();
                  setEmail(username);
                  setEmailError(username.length <= 64 && isValidStaffEmailForRole(`${username}${suffix}`, role) ? "" : emailMessage);
                }}
                onInvalid={(event) => { event.preventDefault(); setEmailError(emailMessage); emailInput.current?.focus(); }}
                required
                maxLength={64}
                pattern={String.raw`[^@\s]+`}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                aria-invalid={Boolean(emailError)}
                aria-describedby={emailHelpId}
                className="min-w-0 flex-1 px-3 py-2.5 text-black focus:outline-none"
                placeholder="alex.mendoza"
              />
              <span aria-hidden="true" className="flex shrink-0 items-center border-l border-neutral/10 bg-base px-2 text-xs text-neutral/75 sm:text-sm">{suffix}</span>
            </span>
            <span id={emailHelpId} role={emailError ? "alert" : undefined} className={`block text-xs ${emailError ? "text-red-700" : "text-neutral/60"}`}>
              {emailError || `Enter only the part before @. The full address will be ${email ? fullEmail : `alex.mendoza${suffix}`}.`}
            </span>
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Role</span>
            <select
              value={role}
              onChange={(event) => {
                const nextRole = event.target.value as StaffRole;
                setRole(nextRole);
                setEmail(staffEmailUsername(email, nextRole));
                setEmailError("");
              }}
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
            <PasswordInput
              aria-label="Temporary password"
              autoComplete="new-password"
              disabled={isSubmitting}
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
