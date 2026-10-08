"use client";

import { useEffect, useState } from "react";
import type { BookingPolicy } from "@/lib/booking/booking-policy";

export default function CurrentBookingPolicy() {
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/booking-policy", { cache: "no-store" }).then(async (response) => {
      const result = (await response.json()) as { policy?: BookingPolicy; message?: string };
      if (!response.ok || !result.policy) throw new Error(result.message ?? "Policy unavailable.");
      if (active) setPolicy(result.policy);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Policy unavailable."); });
    return () => { active = false; };
  }, []);

  if (error) return <p role="alert" className="mb-8 text-sm text-red-700">Current booking policy is unavailable: {error}</p>;
  if (!policy) return <p className="mb-8 text-sm text-neutral/60">Loading current booking policy...</p>;
  return <section className="mb-8 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm text-neutral">
    <h2 className="text-base font-bold">Current cancellation and refund policy · version {policy.version}</h2>
    <p className="mt-2"><strong>Guest cancellation notice:</strong> {policy.guest_cancellation_notice_hours} hours before check-in</p>
    <p className="mt-2 whitespace-pre-wrap"><strong>Cancellation:</strong> {policy.cancellation_text}</p>
    <p className="mt-2 whitespace-pre-wrap"><strong>Refund:</strong> {policy.refund_text}</p>
    <p className="mt-2"><strong>Refund review requests:</strong> {policy.refund_review_enabled ? "Available for verified payments" : "Not created automatically"}</p>
    <p className="mt-2 text-xs text-neutral/70">Your reservation retains the policy version in effect when it is booked.</p>
  </section>;
}
