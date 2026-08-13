"use client";

import Link from "next/link";
import { Suspense, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function ForgotPasswordContent() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!email.trim()) {
      setError("Enter the email address you used to sign in.");
      return;
    }

    setError("");
    setStatus("sending");

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/reset`;

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });

    if (resetError) {
      setError(resetError.message || "Unable to send reset link.");
      setStatus("idle");
      return;
    }

    setStatus("sent");
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-neutral mb-2">Reset your password</h1>
          <p className="text-neutral/70">We will email you a secure link.</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {error ? (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            ) : null}

            {status === "sent" ? (
              <div className="bg-secondary/10 border border-secondary/30 text-neutral px-4 py-3 rounded-lg">
                If an account exists for {email.trim() || "your email"}, a reset link has been sent.
              </div>
            ) : null}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="your@email.com"
              />
            </div>

            <button
              type="submit"
              disabled={status === "sending"}
              className="w-full bg-primary text-base py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {status === "sending" ? "Sending link..." : "Send reset link"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link href="/auth/login" className="text-primary font-semibold hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-base" />}>
      <ForgotPasswordContent />
    </Suspense>
  );
}
