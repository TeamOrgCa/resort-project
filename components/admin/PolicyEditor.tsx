"use client";

import { useEffect, useState } from "react";
import type { BookingPolicy } from "@/lib/booking/booking-policy";

type PolicyVersion = BookingPolicy & { created_by: string | null };

export default function PolicyEditor() {
  const [current, setCurrent] = useState<BookingPolicy | null>(null);
  const [history, setHistory] = useState<PolicyVersion[]>([]);
  const [cancellationText, setCancellationText] = useState("");
  const [refundText, setRefundText] = useState("");
  const [noticeHours, setNoticeHours] = useState("48");
  const [refundReviewEnabled, setRefundReviewEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const changed = current !== null && (
    cancellationText.trim() !== current.cancellation_text ||
    refundText.trim() !== current.refund_text ||
    Number(noticeHours) !== current.guest_cancellation_notice_hours ||
    refundReviewEnabled !== current.refund_review_enabled
  );

  const load = async () => {
    const response = await fetch("/api/admin/booking-policy", { cache: "no-store" });
    const result = (await response.json()) as { policy?: BookingPolicy; history?: PolicyVersion[]; message?: string };
    if (!response.ok || !result.policy) throw new Error(result.message ?? "Unable to load booking policy.");
    setCurrent(result.policy);
    setHistory(result.history ?? []);
    setCancellationText(result.policy.cancellation_text);
    setRefundText(result.policy.refund_text);
    setNoticeHours(String(result.policy.guest_cancellation_notice_hours));
    setRefundReviewEnabled(result.policy.refund_review_enabled);
  };

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load booking policy."))
      .finally(() => setLoading(false));
  }, []);

  const publish = async () => {
    if (!current) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/booking-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationText, refundText, noticeHours: Number(noticeHours), refundReviewEnabled, expectedVersion: current.version }),
      });
      const result = (await response.json()) as { version?: number; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Unable to publish policy.");
      await load();
      setMessage(`Policy version ${result.version} published. New reservations use it; existing reservations keep their booked version.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to publish policy.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-bold text-neutral">Cancellation and refund policy</h2>
        <p className="text-sm text-neutral/70">Only administrators can publish changes. Every version is retained and recorded in the audit log. Refunds still require admin review.</p>
      </div>
      {loading ? <p className="text-sm text-neutral/70">Loading policy...</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      {message ? <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p> : null}
      {current && <>
        <p className="text-xs text-neutral/60">Current version {current.version} · Published {new Date(current.created_at).toLocaleString("en-PH")}</p>
        <label className="block text-sm font-semibold text-neutral">Guest cancellation notice (hours)
          <input type="number" min="0" max="8760" step="1" value={noticeHours} onChange={(event) => setNoticeHours(event.target.value)} className="mt-2 block w-full max-w-xs rounded-lg border border-neutral/20 bg-white px-3 py-2" />
          <span className="mt-1 block text-xs font-normal text-neutral/60">Guest self-service cancellation closes this many hours before check-in. Staff can still review a cancellation.</span>
        </label>
        <label className="block text-sm font-semibold text-neutral">Cancellation policy shown to guests
          <textarea rows={5} maxLength={5000} value={cancellationText} onChange={(event) => setCancellationText(event.target.value)} className="mt-2 block w-full rounded-lg border border-neutral/20 bg-white px-3 py-2 font-normal" />
        </label>
        <label className="block text-sm font-semibold text-neutral">Refund policy shown to guests and reviewers
          <textarea rows={5} maxLength={5000} value={refundText} onChange={(event) => setRefundText(event.target.value)} className="mt-2 block w-full rounded-lg border border-neutral/20 bg-white px-3 py-2 font-normal" />
        </label>
        <label className="flex items-start gap-2 text-sm text-neutral">
          <input type="checkbox" checked={refundReviewEnabled} onChange={(event) => setRefundReviewEnabled(event.target.checked)} className="mt-1" />
          <span>Create a refund review request when a cancelled reservation has verified payments. Staff still decide whether to approve it.</span>
        </label>
        <button type="button" disabled={saving || !changed || cancellationText.trim().length < 20 || refundText.trim().length < 20 || noticeHours.trim() === "" || !Number.isInteger(Number(noticeHours)) || Number(noticeHours) < 0 || Number(noticeHours) > 8760} onClick={() => void publish()} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-base disabled:opacity-50">{saving ? "Publishing..." : "Publish new version"}</button>
        <div className="border-t border-neutral/10 pt-4">
          <h3 className="mb-2 font-semibold text-neutral">Previous versions</h3>
          <div className="space-y-2">{history.map((item) => <details key={item.version} className="rounded-lg border border-neutral/10 bg-white p-3 text-sm">
            <summary className="cursor-pointer font-semibold">Version {item.version} · {new Date(item.created_at).toLocaleString("en-PH")}</summary>
            <p className="mt-3"><strong>Guest notice:</strong> {item.guest_cancellation_notice_hours} hours</p>
            <p className="mt-2 whitespace-pre-wrap"><strong>Cancellation:</strong> {item.cancellation_text}</p>
            <p className="mt-2 whitespace-pre-wrap"><strong>Refund:</strong> {item.refund_text}</p>
            <p className="mt-2"><strong>Refund review requests:</strong> {item.refund_review_enabled ? "Enabled" : "Disabled"}</p>
          </details>)}</div>
        </div>
      </>}
    </div>
  );
}
