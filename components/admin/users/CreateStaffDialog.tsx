"use client";

import { useEffect, useState } from "react";

import StaffDialogShell from "@/components/admin/users/StaffDialogShell";
import type { StaffUserFormValues } from "@/components/admin/users/types";
import type { StaffRole } from "@/lib/auth/staff-auth";

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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFullName("");
    setEmail("");
    setRole("staff");
    setPassword("");
    setIsActive(true);
  }, [isOpen]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await onSubmit({
      fullName: fullName.trim(),
      email: email.trim(),
      role,
      password,
      isActive,
    });
  };

  return (
    <StaffDialogShell
      isOpen={isOpen}
      title="Create Staff User"
      description="Provision a new Supabase auth account and matching staff profile."
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
              placeholder="Alex Mendoza"
            />
          </label>

          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 focus:border-primary focus:outline-none"
              placeholder="alex@marville.example"
            />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="block text-sm font-medium text-neutral">Role</span>
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as StaffRole)}
              className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 focus:border-primary focus:outline-none"
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
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
              className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 focus:border-primary focus:outline-none"
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
            {isSubmitting ? "Creating..." : "Create Staff User"}
          </button>
        </div>
      </form>
    </StaffDialogShell>
  );
}