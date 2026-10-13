"use client";

import Link from "next/link";
import { SiteImage, SiteText, contentText, useSiteContent } from "@/components/content/SiteContent";
import { isContentImageUrl, publicContentDefaults } from "@/lib/settings/public-content";
import { usePackageRates } from "@/lib/booking/use-package-rates";
import { PACKAGE_LABELS, PACKAGE_MODES, RATE_TIERS } from "@/lib/booking/package-rates";
import { INCLUDED_GUESTS } from "@/lib/booking/guest-count";

const currency = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 });
const brochures = [
  { key: "content.about.info_poster", title: "content.about.info_poster_title", width: 816, height: 1056, alt: "MarVille private swimming brochure with package inclusions, rates and resort information" },
  { key: "content.about.pricing_poster", title: "content.about.pricing_poster_title", width: 1080, height: 1920, alt: "MarVille brochure with public swimming, cottage, room, videoke and cooking information" },
];

export default function ResortRates() {
  const { schedule, error } = usePackageRates();
  const content = useSiteContent();

  return (
    <section id="rates" className="scroll-mt-28 bg-neutral/5 px-4 py-16 sm:py-20" aria-labelledby="rates-heading">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-10 max-w-3xl text-center">
          <h2 id="rates-heading" className="mb-4 text-3xl font-bold text-neutral sm:text-4xl"><SiteText contentKey="content.about.rates_heading" /></h2>
          <p className="text-lg text-neutral/75"><SiteText contentKey="content.about.rates_description" /></p>
        </div>

        {schedule ? (
          <div className="grid gap-5 lg:grid-cols-3">
            {PACKAGE_MODES.map(mode => (
              <article key={mode} className="rounded-2xl border border-neutral/10 bg-base p-5 shadow-sm sm:p-6">
                <h3 className="text-xl font-bold text-primary">{PACKAGE_LABELS[mode].name}</h3>
                <p className="mt-2 min-h-12 text-sm leading-relaxed text-neutral/70">{PACKAGE_LABELS[mode].times}</p>
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
        ) : (
          <p role={error ? "alert" : "status"} className="rounded-2xl border border-neutral/10 bg-base p-6 text-center text-neutral/75">
            {error ? "Current package prices are temporarily unavailable. Please contact the resort or try again later." : "Loading current package prices…"}
          </p>
        )}
        <p className="mt-5 text-center text-sm leading-relaxed text-neutral/70"><SiteText contentKey="content.about.rates_note" /></p>
        <div className="mt-6 text-center">
          <Link href="/booking" className="inline-flex rounded-full bg-primary px-7 py-3 font-semibold text-white transition-colors hover:bg-primary/90"><SiteText contentKey="content.about.book_your_stay" /></Link>
        </div>

        <div className="my-12 grid gap-6 md:grid-cols-2">
          <article className="rounded-2xl border border-neutral/10 bg-base p-6 sm:p-8">
            <h3 className="mb-4 text-xl font-bold text-neutral"><SiteText contentKey="content.about.inclusions_heading" /></h3>
            <ul className="list-disc space-y-2 pl-5 text-neutral/75">
              {contentText(content, "content.about.inclusions").split("\n").filter(line => line.trim()).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </article>
          <article className="rounded-2xl border border-neutral/10 bg-base p-6 sm:p-8">
            <h3 className="mb-4 text-xl font-bold text-neutral"><SiteText contentKey="content.about.reminders_heading" /></h3>
            <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed text-neutral/75">
              {contentText(content, "content.about.reminders").split("\n").filter(line => line.trim()).map((line, index) => <li key={index}>{line}</li>)}
            </ul>
          </article>
        </div>

        <div className="mb-7 max-w-3xl">
          <h3 className="mb-3 text-2xl font-bold text-neutral"><SiteText contentKey="content.about.posters_heading" /></h3>
          <p className="leading-relaxed text-neutral/75"><SiteText contentKey="content.about.posters_description" /></p>
        </div>
        <p className="mb-7 rounded-xl border border-primary/15 bg-primary/5 p-4 text-sm leading-relaxed text-neutral/80"><SiteText contentKey="content.about.posters_note" /></p>
        <div className="grid items-start gap-7 md:grid-cols-2">
          {brochures.map(brochure => {
            const source = contentText(content, brochure.key);
            const href = isContentImageUrl(source) ? source : String(publicContentDefaults[brochure.key]);
            return (
              <figure key={brochure.key} className="overflow-hidden rounded-2xl border border-neutral/10 bg-white shadow-sm">
                <figcaption className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                  <h4 className="font-semibold text-neutral"><SiteText contentKey={brochure.title} /></h4>
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-primary underline underline-offset-4">Open full size<span className="sr-only">: {contentText(content, brochure.title)} (new tab)</span></a>
                </figcaption>
                <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${contentText(content, brochure.title)} at full size (new tab)`}>
                  <SiteImage contentKey={brochure.key} alt={brochure.alt} width={brochure.width} height={brochure.height} sizes="(min-width: 768px) 50vw, 100vw" className="h-auto w-full" />
                </a>
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
