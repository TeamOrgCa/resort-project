"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

interface LoginApiResponse {
  success: boolean;
  message: string;
  requiresOtp?: boolean;
  staffUser?: { mustChangePassword?: boolean };
}

export default function AdminLoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [requiresOtp, setRequiresOtp] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(requiresOtp ? "/api/admin/auth/verify-otp" : "/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requiresOtp ? { email, token: otp } : { email, password }),
      });

      const data = (await response.json()) as LoginApiResponse;

      if (!response.ok || !data.success) {
        setError(data.message || "Unable to sign in.");
        return;
      }

      if (data.requiresOtp) {
        setRequiresOtp(true);
        setPassword("");
        return;
      }

      router.push(data.staffUser?.mustChangePassword ? "/staff/change-password" : "/admin");
      router.refresh();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {searchParams.get("reason") === "session-replaced" && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-neutral">This account was signed in on another device. Your session here has ended. Sign in again to continue.</p>}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      {!requiresOtp ? <div>
        <label htmlFor="admin-email" className="mb-2 block text-sm font-medium text-neutral">
          Staff Email
        </label>
        <input
          id="admin-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          className="w-full rounded-lg border border-neutral/20 px-3 py-2 focus:border-primary focus:outline-none"
          placeholder="staff@marville.example"
        />
      </div> : null}

      {!requiresOtp ? <div>
        <label htmlFor="admin-password" className="mb-2 block text-sm font-medium text-neutral">
          Password
        </label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          className="w-full rounded-lg border border-neutral/20 px-3 py-2 focus:border-primary focus:outline-none"
          placeholder="••••••••"
        />
      </div> : null}

      {requiresOtp ? <div>
        <p className="mb-3 text-sm text-neutral/70">Enter the verification code sent to your staff email.</p>
        <label htmlFor="admin-otp" className="mb-2 block text-sm font-medium text-neutral">Verification Code</label>
        <input
          id="admin-otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={otp}
          onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 8))}
          required
          className="w-full rounded-lg border border-neutral/20 px-3 py-2 text-center tracking-[0.35em] focus:border-primary focus:outline-none"
          placeholder="00000000"
        />
      </div> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded-lg bg-primary px-4 py-3 font-semibold text-base transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isSubmitting ? "Verifying..." : requiresOtp ? "Verify Code" : "Sign In to Staff Portal"}
      </button>

      {!requiresOtp ? <Link href="/auth/forgot?staff=1" className="block text-center text-sm font-medium text-primary hover:underline">
        Forgot your password?
      </Link> : null}
    </form>
  );
}
