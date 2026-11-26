"use client";
import { contentText, useSiteContent } from "@/components/content/SiteContent";

export default function PrivatePackageDetails({ compact = false }: { compact?: boolean }) {
  const content = useSiteContent();
  return <section aria-label="Private swimming package inclusions" className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-neutral">
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
        <h3 className="font-semibold">Included in your private swimming package</h3>
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
      </summary>
      <p className="mt-3 text-sm font-semibold">2 Standard rooms included at no extra charge for your swimming session.</p>
      <p className="mt-2 text-sm text-neutral/80">These two rooms are dedicated to private swimming packages and are unavailable for public swimming or room-only bookings.</p>
      {!compact && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral/80">{contentText(content, "content.about.inclusions").split("\n").filter(line => line.trim()).map(line => <li key={line}>{line}</li>)}</ul>}
      <p className="mt-3 text-sm text-neutral/70">The two included rooms are available for your swimming session. Additional rooms are optional and charged for the chosen duration, hourly extensions and extra guests at configured rates. All rooms and extensions must end by swimming checkout.</p>
    </details>
  </section>;
}
