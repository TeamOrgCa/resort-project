"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import LegalDocument from "@/components/legal/LegalDocument";
import { privacySections, termsSections } from "@/lib/legal/policies";

export default function PolicyAgreement({ accepted, onChange }: { accepted: boolean; onChange: (value: boolean) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [reachedEnd, setReachedEnd] = useState(false);

  const checkScroll = () => {
    const element = scrollRef.current;
    if (element && element.scrollTop + element.clientHeight >= element.scrollHeight - 8) setReachedEnd(true);
  };

  return (
    <section className="rounded-xl border border-neutral/20 bg-base p-4" aria-labelledby="policy-agreement-heading">
      <h3 id="policy-agreement-heading" className="text-lg font-semibold text-neutral">Terms and Privacy Policy</h3>
      <p className="mt-1 text-sm text-neutral/70">Scroll to the end of both documents before agreeing. You can also open the <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline">Terms and Conditions</Link> and <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline">Privacy Policy</Link> in separate tabs.</p>
      <div ref={scrollRef} onScroll={checkScroll} tabIndex={0} role="region" aria-label="Terms and Privacy Policy; scroll to the end" className="mt-4 h-72 overflow-y-auto rounded-lg border border-neutral/20 bg-white p-4 focus:outline-2 focus:outline-primary">
        <h4 className="mb-1 text-lg font-bold text-neutral">Terms and Conditions</h4>
        <p className="mb-5 text-xs text-neutral/60">MarVille Resort Complex · Last updated October 2026</p>
        <LegalDocument sections={termsSections} />
        <h4 className="mb-1 mt-8 text-lg font-bold text-neutral">Privacy Policy</h4>
        <p className="mb-5 text-xs text-neutral/60">MarVille Resort Complex · Last updated October 2026</p>
        <LegalDocument sections={privacySections} />
        <p className="pt-4 text-sm font-semibold text-neutral">End of Terms and Privacy Policy</p>
      </div>
      <p className="mt-2 text-xs text-neutral/70" aria-live="polite">{reachedEnd ? "You can now agree below." : "Read and scroll to the end to enable the checkbox."}</p>
      <label className={`mt-3 flex items-start gap-2 text-sm ${reachedEnd ? "text-neutral" : "text-neutral/50"}`}>
        <input type="checkbox" checked={accepted} disabled={!reachedEnd} onChange={(event) => onChange(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
        <span>I have read and agree to the Terms and Conditions and acknowledge the Privacy Policy.</span>
      </label>
    </section>
  );
}
