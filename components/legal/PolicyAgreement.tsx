"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import LegalDocument from "./LegalDocument";
import { documentDateLabel, legalContentSections, type LegalPolicies } from "@/lib/legal/documents";
import type { BookingPolicy } from "@/lib/booking/booking-policy";

export default function PolicyAgreement({ accepted, onChange, reservationId, onPolicyVersion, onLegalVersion, reloadKey = 0, name, required = false, disabled = false }: {
  accepted: boolean; onChange: (value: boolean) => void; reservationId?: string;
  onPolicyVersion?: (version: number) => void; onLegalVersion?: (version: string | null) => void;
  reloadKey?: number; name?: string; required?: boolean; disabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onPolicyVersion, onLegalVersion });
  useEffect(() => { callbacks.current = { onChange, onPolicyVersion, onLegalVersion }; }, [onChange, onPolicyVersion, onLegalVersion]);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [legal, setLegal] = useState<LegalPolicies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setError(null); setPolicy(null); setLegal(null); setReachedEnd(false);
      callbacks.current.onChange(false); callbacks.current.onLegalVersion?.(null);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      const query = reservationId ? `?reservationId=${encodeURIComponent(reservationId)}` : "";
      try {
        const [booking, documents] = await Promise.all([fetch(`/api/booking-policy${query}`, { cache: "no-store", signal: controller.signal }), fetch(`/api/legal-policies${query}`, { cache: "no-store", signal: controller.signal })]);
        const [bookingResult, legalResult] = await Promise.all([booking.json(), documents.json()]);
        if (!booking.ok || !bookingResult.policy) throw new Error(bookingResult.message ?? "Unable to load booking policy.");
        if (!documents.ok || !legalResult.policies?.terms || !legalResult.policies?.privacy) throw new Error(legalResult.message ?? "Unable to load Terms and Privacy Policy.");
        if (controller.signal.aborted) return;
        setPolicy(bookingResult.policy); setLegal(legalResult.policies);
        callbacks.current.onPolicyVersion?.(bookingResult.policy.version);
        callbacks.current.onLegalVersion?.(legalResult.policies.version);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load policies."); }
    };
    void load();
    return () => controller.abort();
  }, [reservationId, reloadKey, loadAttempt]);

  const ready = Boolean(policy && legal);
  return <section className="rounded-xl border border-neutral/20 bg-base p-4" aria-labelledby="policy-agreement-heading">
    <h3 id="policy-agreement-heading" className="text-lg font-semibold text-neutral">Terms and Privacy Policy</h3>
    <p className="mt-1 text-sm text-neutral/70">Read and scroll to the end of both documents before agreeing. Current copies are also available on the <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">Terms and Conditions</Link> and <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">Privacy Policy</Link> pages.</p>
    {error && <div role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-700"><p>{error}</p><button type="button" disabled={disabled} onClick={() => setLoadAttempt(value => value + 1)} className="mt-2 min-h-11 rounded-lg border border-red-200 px-3 py-2 font-semibold hover:bg-red-100 disabled:opacity-50">Retry loading policies</button></div>}
    <div ref={scrollRef} tabIndex={0} role="region" aria-label="Terms and Privacy Policy; scroll to the end" aria-busy={!ready && !error}
      onScroll={() => { const element = scrollRef.current; if (ready && element && element.clientHeight > 0 && element.scrollTop + element.clientHeight >= element.scrollHeight - 8) setReachedEnd(true); }}
      className="mt-4 h-72 overflow-y-auto rounded-lg border border-neutral/20 bg-white p-4 focus:outline-2 focus:outline-primary">
      {!ready && <p className="text-sm text-neutral/60">{error ? "Policies could not be loaded. Retry above before agreeing." : "Loading current policies..."}</p>}
      {legal && policy && <>
        {legal.legacy && <p className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">This older booking has no recorded legal acceptance version. The original website documents are shown for reference.</p>}
        <h4 className="mb-1 text-lg font-bold text-neutral">{legal.terms.title}</h4>
        <p className="mb-5 text-xs text-neutral/60">Version {legal.terms.version} · Published {documentDateLabel(legal.terms.published_at)}</p>
        <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-neutral">
          <h5 className="font-bold">Booking policy · version {policy.version}</h5>
          <p className="mt-2"><strong>Guest cancellation notice:</strong> {policy.guest_cancellation_notice_hours} hours before check-in</p>
          <p className="mt-2 whitespace-pre-wrap"><strong>Cancellation:</strong> {policy.cancellation_text}</p>
          <p className="mt-2 whitespace-pre-wrap"><strong>Refund:</strong> {policy.refund_text}</p>
        </div>
        <LegalDocument sections={legalContentSections(legal.terms.content)} />
        <h4 className="mb-1 mt-8 text-lg font-bold text-neutral">{legal.privacy.title}</h4>
        <p className="mb-5 text-xs text-neutral/60">Version {legal.privacy.version} · Published {documentDateLabel(legal.privacy.published_at)}</p>
        <LegalDocument sections={legalContentSections(legal.privacy.content)} />
        <p className="pt-4 text-sm font-semibold text-neutral">End of Terms and Privacy Policy</p>
      </>}
    </div>
    <p className="mt-2 text-xs text-neutral/70" aria-live="polite">{reachedEnd && ready ? "You can now agree below." : "Read and scroll to the end to enable the checkbox."}</p>
    <label className={`mt-3 flex items-start gap-2 text-sm ${reachedEnd && ready ? "text-neutral" : "text-neutral/50"}`}>
      <input type="checkbox" name={name} required={required} checked={accepted} disabled={disabled || !reachedEnd || !ready}
        onChange={event => { if (reachedEnd && ready && !disabled) onChange(event.target.checked); }} className="mt-1 h-4 w-4 shrink-0" />
      <span>I have read and agree to the Terms and Conditions and acknowledge the Privacy Policy.</span>
    </label>
  </section>;
}
