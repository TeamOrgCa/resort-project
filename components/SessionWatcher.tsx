"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export default function SessionWatcher() {
  useEffect(() => {
    const supabase = createClient();
    let checking = false;
    let leaving = false;
    const check = async () => {
      if (checking || leaving || /^(\/auth\/|\/staff\/login)/.test(window.location.pathname)) return;
      checking = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const response = await fetch("/api/auth/session-status", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json() as { kind?: "staff" | "guest"; status?: string };
        if (result.status !== "replaced" && result.status !== "none") return;
        leaving = true;
        await supabase.auth.signOut({ scope: "local" });
        const isStaff = result.kind === "staff" || window.location.pathname.startsWith("/admin") || window.location.pathname.startsWith("/staff");
        window.location.replace(`${isStaff ? "/staff/login" : "/auth/login"}?reason=session-replaced`);
      } catch {
        // A temporary network failure must not sign out the current device.
      } finally {
        checking = false;
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 60000);
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, []);
  return null;
}
