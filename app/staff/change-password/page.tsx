"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ChangeStaffPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword }),
      });
      const data = await response.json() as { success: boolean; message?: string };
      if (!response.ok || !data.success) {
        setError(data.message || "Unable to update your password.");
        return;
      }
      router.push("/admin");
      router.refresh();
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-base px-4 py-12">
      <section className="mx-auto max-w-md rounded-3xl bg-white p-8 shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">Staff Portal</p>
        <h1 className="mt-3 text-3xl font-bold text-neutral">Change your temporary password</h1>
        <p className="mt-3 text-sm text-neutral/70">Set a personal password before continuing to the staff portal.</p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <label className="block text-sm font-medium text-neutral">
            New Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={128} required className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 focus:border-primary focus:outline-none" />
          </label>
          <label className="block text-sm font-medium text-neutral">
            Confirm Password
            <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={128} required className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 focus:border-primary focus:outline-none" />
          </label>
          <button type="submit" disabled={isSubmitting} className="w-full rounded-lg bg-primary px-4 py-3 font-semibold text-base disabled:cursor-not-allowed disabled:opacity-70">
            {isSubmitting ? "Updating..." : "Set New Password"}
          </button>
        </form>
      </section>
    </main>
  );
}