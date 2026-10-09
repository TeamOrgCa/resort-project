"use client";

import { useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

export default function CompleteEmailConfirmation() {
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get("access_token");
    const type = fragment.get("type");
    window.history.replaceState(null, "", window.location.pathname);

    const finish = (success: boolean) => {
      window.location.replace(`/auth/login?confirmation=${success ? "success" : "invalid"}`);
    };

    if (fragment.has("error") || type !== "signup" || !token) {
      finish(false);
      return;
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } },
    );
    void supabase.auth.getUser(token).then(({ data, error }) => {
      finish(!error && Boolean(data.user?.email_confirmed_at));
    }).catch(() => finish(false));
  }, []);

  return <main className="min-h-screen bg-base flex items-center justify-center px-4"><p role="status" className="text-neutral">Checking email confirmation...</p></main>;
}
