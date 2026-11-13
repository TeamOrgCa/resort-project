"use client";

import { useEffect, useState } from "react";
import { documentDateLabel, legalContentSections, type LegalDocumentType, type LegalPolicies } from "@/lib/legal/documents";
import LegalDocument from "./LegalDocument";
import CurrentBookingPolicy from "./CurrentBookingPolicy";

export default function PublishedLegalPage({ documentType }: { documentType: LegalDocumentType }) {
  const [policies, setPolicies] = useState<LegalPolicies | null>(null), [error, setError] = useState<string | null>(null), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setError(null);
      try {
        const response = await fetch("/api/legal-policies", { cache: "no-store", signal: controller.signal }), result = await response.json();
        if (!response.ok || !result.policies) throw new Error(result.message ?? "Unable to load this policy.");
        if (!controller.signal.aborted) setPolicies(result.policies);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load this policy."); }
    };
    void load(); return () => controller.abort();
  }, [attempt]);
  const document = policies?.[documentType];
  return <article className="rounded-2xl bg-white p-6 shadow-sm sm:p-10">
    <h1 className="text-3xl font-bold text-neutral">{document?.title ?? (documentType === "terms" ? "Terms and Conditions" : "Privacy Policy")}</h1>
    {error && <div role="alert" className="my-5 rounded-xl bg-red-50 p-4 text-sm text-red-700"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 min-h-11 rounded-lg border px-4 py-2">Retry loading policy</button></div>}
    {!document && !error && <p role="status" className="my-5 text-neutral/60">Loading published policy...</p>}
    {document && <><p className="mb-8 mt-2 text-sm text-neutral/60">Version {document.version} · Published {documentDateLabel(document.published_at)}</p>
      {documentType === "terms" && <CurrentBookingPolicy />}
      <LegalDocument sections={legalContentSections(document.content)} />
    </>}
  </article>;
}
