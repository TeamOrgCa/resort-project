"use client";
import { contentText, useSiteContent } from "@/components/content/SiteContent";

export default function PrivatePackageDetails({ compact = false }: { compact?: boolean }) {
  const content = useSiteContent();
  return <section aria-label="Private swimming package inclusions" className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 text-neutral">
    <h3 className="font-semibold">Included in your private swimming package</h3>
    <p className="mt-2 text-sm font-semibold">2 Standard rooms included at no extra charge for your swimming session.</p>
    <p className="mt-2 text-sm text-neutral/80">These two rooms are dedicated to private swimming packages and are unavailable for public swimming or room-only bookings.</p>
    {!compact && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral/80">{contentText(content, "content.about.inclusions").split("\n").filter(line => line.trim()).map(line => <li key={line}>{line}</li>)}</ul>}
    <p className="mt-3 text-sm text-neutral/70">Additional rooms are optional and charged separately at the displayed room rates. Room use ends with your selected swimming session; additional stays or extensions have separate charges.</p>
  </section>;
}
