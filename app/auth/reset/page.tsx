"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function ResetPasswordContent() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        return;
      }

      if (event === "PASSWORD_RECOVERY" || session) {
        setHasRecoverySession(true);
      }

      setIsReady(true);
    });

    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!isMounted) {
        return;
      }

      if (sessionData.session) {
        setHasRecoverySession(true);
      }

      setIsReady(true);
    });

    return () => {
      isMounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleReset = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setSuccess("");
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      setError(updateError.message || "Unable to update password.");
      setIsSubmitting(false);
      return;
    }

    setSuccess("Password updated. You can now sign in.");
    setIsSubmitting(false);

    window.setTimeout(() => {
      router.push("/auth/login");
    }, 1200);
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-neutral mb-2">Create a new password</h1>
          <p className="text-neutral/70">Use a strong password you have not used before.</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-8">
          {!isReady ? (
            <p className="text-sm text-neutral/70">Checking reset link...</p>
          ) : !hasRecoverySession ? (
            <div className="space-y-4">
              <p className="text-sm text-neutral/70">
                This reset link is invalid or has expired. Please request a new one.
              </p>
              <Link href="/auth/forgot" className="text-primary font-semibold hover:underline">
                Request a new reset link
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-6">
              {error ? (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                  {error}
                </div>
              ) : null}

              {success ? (
                <div className="bg-secondary/10 border border-secondary/30 text-neutral px-4 py-3 rounded-lg">
                  {success}
                </div>
              ) : null}

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-neutral mb-2">
                  New Password
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="••••••••"
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-neutral mb-2">
                  Confirm Password
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary text-base py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Updating..." : "Update password"}
              </button>

              <div className="text-center">
                <Link href="/auth/login" className="text-primary font-semibold hover:underline">
                  Back to sign in
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-base" />}>
      <ResetPasswordContent />
    </Suspense>
  );
}
