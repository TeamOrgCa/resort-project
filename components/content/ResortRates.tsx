"use client";

import Link from "next/link";
import { SiteText, contentText, useSiteContent } from "@/components/content/SiteContent";
import { usePackageRates } from "@/lib/booking/use-package-rates";
import { packageTimesLabel } from "@/lib/booking/package-times";
import { PACKAGE_LABELS, PACKAGE_MODES, RATE_TIERS } from "@/lib/booking/package-rates";
import { INCLUDED_GUESTS } from "@/lib/booking/guest-count";
import Skeleton, { SkeletonGroup } from "@/components/ui/Skeleton";

const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });

export default function ResortRates() {
  const { schedule, error } = usePackageRates();
  const content = useSiteContent();

  return (
    <section id="rates" className="scroll-mt-28 bg-neutral/5 px-4 py-16 sm:py-20" aria-labelledby="rates-heading">
      <div className="mx-auto max-w-6xl">
        <div data-reveal className="mx-auto mb-10 max-w-3xl text-center">
          <h2 id="rates-heading" className="mb-4 text-3xl font-bold text-neutral sm:text-4xl"><SiteText contentKey="content.about.rates_heading" /></h2>
          <p className="text-lg text-neutral/75"><SiteText contentKey="content.about.rates_description" /></p>
        </div>

        {schedule ? (
          <div className="grid gap-5 lg:grid-cols-3">
            {PACKAGE_MODES.map(mode => (
              <article key={mode} className="content-fade-in rounded-2xl border border-neutral/10 bg-base p-5 shadow-sm sm:p-6">
                <h3 className="text-xl font-bold text-primary">{PACKAGE_LABELS[mode].name}</h3>
                <p className="mt-2 min-h-12 text-sm leading-relaxed text-neutral/70">{packageTimesLabel(mode, schedule.times)}</p>
                <dl className="mt-5 space-y-4">
                  {RATE_TIERS.map(tier => (
                    <div key={tier} className="rounded-xl bg-white p-4">
                      <dt className="text-sm font-semibold text-neutral">{tier === "weekday" ? "Weekday · Monday–Thursday" : "Weekend · Friday–Sunday"}</dt>
                      <dd className="mt-2">
                        <p className="text-2xl font-bold text-neutral">{currency.format(schedule.rates[tier][mode].baseRate)}</p>
                        <p className="mt-1 text-sm text-neutral/70">Includes {INCLUDED_GUESTS} guests</p>
                        <p className="mt-2 text-sm text-neutral/75">{currency.format(schedule.rates[tier][mode].addOnPerHead)} per extra guest</p>
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
          </div>
        ) : error ? (
          <p role="alert" className="rounded-2xl border border-neutral/10 bg-base p-6 text-center text-neutral/75">Current package prices are temporarily unavailable. Please contact the resort or try again later.</p>
        ) : (
          <SkeletonGroup label="Loading current package prices…">
            <div className="grid gap-5 lg:grid-cols-3">{PACKAGE_MODES.map(mode => <div key={mode} className="rounded-2xl border border-neutral/10 bg-base p-5 sm:p-6">
              <Skeleton className="h-7 w-40 max-w-full" /><Skeleton className="mt-2 h-12 w-full" />
              <div className="mt-5 space-y-4">{RATE_TIERS.map(tier => <div key={tier} className="space-y-3 rounded-xl bg-white p-4">
                <Skeleton className="h-5 w-full" /><Skeleton className="h-8 w-32" /><Skeleton className="h-5 w-36 max-w-full" /><Skeleton className="h-5 w-40 max-w-full" />
              </div>)}</div>
            </div>)}</div>
          </SkeletonGroup>
        )}
        <p className="mt-5 text-center text-sm leading-relaxed text-neutral/70"><SiteText contentKey="content.about.rates_note" /></p>
        <div className="mt-6 text-center">
          <Link href="/booking" className="inline-flex rounded-full bg-primary px-7 py-3 font-semibold text-white transition-colors hover:bg-primary/90"><SiteText contentKey="content.about.book_your_stay" /></Link>
        </div>

        <div className="my-12 grid gap-6 md:grid-cols-2">
          <article data-reveal className="rounded-2xl border border-neutral/10 bg-base p-6 sm:p-8">
            <h3 className="mb-4 text-xl font-bold text-neutral"><SiteText contentKey="content.about.inclusions_heading" /></h3>
            <ul className="list-disc space-y-2 pl-5 text-neutral/75">
              {contentText(content, "content.about.inclusions").split("\n").filter(line => line.trim()).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </article>
          <article data-reveal className="rounded-2xl border border-neutral/10 bg-base p-6 sm:p-8">
            <h3 className="mb-4 text-xl font-bold text-neutral"><SiteText contentKey="content.about.reminders_heading" /></h3>
            <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-neutral/75">
              {contentText(content, "content.about.reminders").split("\n").filter(line => line.trim()).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </article>
        </div>

      </div>
    </section>
  );
}
