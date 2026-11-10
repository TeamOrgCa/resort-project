"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DEACTIVATED_GUEST_MESSAGE } from "@/lib/auth/guest-access";
import { EMAIL_INPUT_ERROR, isValidLoginEmail, sanitizeEmailInput } from "@/lib/validation/email";
import PasswordInput from "@/components/ui/PasswordInput";
import { showLoginSuccessToast } from "@/components/ui/LoginSuccessToast";
import { beginSessionChange } from "@/lib/auth/session-events";

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';
  const sessionReplaced = searchParams.get("reason") === "session-replaced";
  const accountDeactivated = searchParams.get("reason") === "account-deactivated";
  const confirmation = searchParams.get("confirmation");
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [limit, setLimit] = useState<{ email: string; remaining: number; until: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const currentLimit = limit?.email === email.toLowerCase() ? limit : null;
  const secondsLeft = currentLimit ? Math.max(0, Math.ceil((currentLimit.until - now) / 1000)) : 0;
  const attemptsLeft = currentLimit?.until && secondsLeft === 0 ? 4 : currentLimit?.remaining ?? 4;

  useEffect(() => {
    if (!limit?.until) return;
    const timer = window.setInterval(() => {
      const currentTime = Date.now(); setNow(currentTime);
      if (limit.until <= currentTime) {
        setLimit(current => current ? { ...current, remaining: 4, until: 0 } : current);
        if (limit.email === email.toLowerCase()) setError("");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [limit, email]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || signedIn || secondsLeft > 0) return;
    setError("");
    if (!isValidLoginEmail(email)) { setError(EMAIL_INPUT_ERROR); return; }
    setLoading(true);
    const finishSessionChange = beginSessionChange();

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as { success: boolean; message: string; firstName?: string; attemptsRemaining?: number; retryAfterSeconds?: number };
      if (!response.ok || !data.success) {
        if (typeof data.attemptsRemaining === "number") {
          const receivedAt = Date.now(); setNow(receivedAt);
          setLimit({ email: email.toLowerCase(), remaining: data.attemptsRemaining,
            until: data.retryAfterSeconds ? receivedAt + data.retryAfterSeconds * 1000 : 0 });
        }
        setError(data.message || "Unable to sign in.");
        return;
      }
      setPassword("");
      setSignedIn(true);
      showLoginSuccessToast(`Welcome back, ${data.firstName?.trim() || email.split("@")[0]}!`);
      router.push(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/");
      router.refresh();
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      finishSessionChange();
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-base flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/">
            <Image 
              src="/website_logo_transparent.png" 
              alt="MarVille Resort" 
              width={200} 
              height={80} 
              className="mx-auto mb-4"
            />
          </Link>
          <h1 className="text-3xl font-bold text-neutral mb-2">Welcome Back</h1>
          <p className="text-neutral/70">Sign in to manage your bookings</p>
        </div>

        {/* Login Form */}
        <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-8">
          <form onSubmit={handleLogin} className="space-y-6">
            {confirmation === "success" && <p role="status" className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-neutral">Email confirmed. You can now sign in.</p>}
            {confirmation === "invalid" && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-neutral">This confirmation link is invalid or has expired. Request a new email from the registration page.</p>}
            {sessionReplaced && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-neutral">This account was signed in on another device. Your session here has ended. Sign in again to continue.</p>}
            {accountDeactivated && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-neutral">{DEACTIVATED_GUEST_MESSAGE}</p>}
            {error && (
              <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-neutral mb-2">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(sanitizeEmailInput(e.target.value))}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                required
                className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="your@email.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-neutral mb-2">
                Password
              </label>
              <PasswordInput
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 border border-neutral/20 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="••••••••"
              />
            </div>

            <div className="text-right">
              <Link href="/auth/forgot" className="text-sm text-primary font-semibold hover:underline">
                Forgot password?
              </Link>
            </div>

            <p id="login-attempt-status" aria-live="polite" className={`text-sm ${secondsLeft > 0 ? "font-semibold text-red-700" : "text-neutral/70"}`}>
              {secondsLeft > 0 ? `Too many failed attempts. Try again in ${secondsLeft} ${secondsLeft === 1 ? "second" : "seconds"}.` : `${attemptsLeft} login ${attemptsLeft === 1 ? "attempt" : "attempts"} remaining. Four failed attempts lock login for 1 minute.`}
            </p>
            <button
              type="submit"
              disabled={loading || signedIn || secondsLeft > 0}
              className="w-full bg-primary text-base py-3 rounded-lg font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Signing in..." : secondsLeft > 0 ? `Try again in ${secondsLeft}s` : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-neutral/70">
              Don&apos;t have an account?{" "}
              <Link href="/auth/register" className="text-primary font-semibold hover:underline">
                Sign up
              </Link>
            </p>
          </div>

          <div className="mt-4 text-center">
            <Link href="/" className="text-neutral/60 text-sm hover:text-primary transition-colors">
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Login() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-base" />}>
      <LoginContent />
    </Suspense>
  );
}
