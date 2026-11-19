"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import { contentText, useSiteContent } from "@/components/content/SiteContent";
import { isContentImageUrl } from "@/lib/settings/public-content";

/** Shared branding for printable billing documents. */
export default function BillingDocument({ title, kicker, intro, recordName, toolbar, children }: {
  title: string;
  kicker: string;
  intro: string;
  recordName: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const content = useSiteContent();
  const name = contentText(content, "resort.name"), logo = contentText(content, "content.branding.logo");
  const contactNumbers = content["resort.contact_numbers"];
  const phones = Array.isArray(contactNumbers) ? contactNumbers.filter(value => typeof value === "string").join(" / ") : contentText(content, "resort.contact_numbers");

  return <article className="receipt-document receipt-branded">
    <header className="receipt-brand">
      <div><p className="receipt-brand-eyebrow">Your private resort escape</p><h2>{name}</h2><p className="receipt-brand-tagline">Where the Sun Never Sets</p></div>
      {isContentImageUrl(logo) && <div className="receipt-logo"><Image unoptimized loading="eager" src={logo} alt={`${name} logo`} width={140} height={60} className={logo.endsWith("/website_logo_transparent.png") ? "receipt-logo-default" : undefined} /></div>}
    </header>
    <div className="receipt-body">
      <div className="receipt-title-row"><div><p className="receipt-kicker">{kicker}</p><h1>{title}</h1></div>
        <div className="receipt-screen-only receipt-toolbar">{toolbar}</div>
      </div>
      <p className="receipt-intro">{intro}</p>
      {children}
    </div>
    <footer className="receipt-footer"><p className="receipt-thanks">Thank you for choosing {name}.</p><p>Keep this {recordName} for your records.</p>
      <address>{contentText(content, "resort.address")}<br />{contentText(content, "resort.email")}{phones && <><br />{phones}</>}</address>
    </footer>
  </article>;
}
