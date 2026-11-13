import type { LegalSection } from "./policies";

export type LegalDocumentType = "terms" | "privacy";
export type PublishedLegalDocument = {
  policy_id: string; document_type: LegalDocumentType; version: number;
  title: string; content: string; published_at: string; published_by?: string | null;
  change_note?: string; is_active?: boolean;
};
export type LegalPolicies = { terms: PublishedLegalDocument; privacy: PublishedLegalDocument; version: string; legacy?: boolean };

export const legalPolicyToken = (termsVersion: number, privacyVersion: number) => `terms:${termsVersion};privacy:${privacyVersion}`;
export const isLegalPolicyToken = (value: unknown): value is string => typeof value === "string" && /^terms:[1-9]\d{0,8};privacy:[1-9]\d{0,8}$/.test(value);

/** Render administrator text as text, headings and lists; never evaluate HTML. */
export function legalContentSections(content: string): LegalSection[] {
  const sections: LegalSection[] = [];
  let section: LegalSection = { heading: "", paragraphs: [], items: [] }, paragraph: string[] = [];
  const flush = () => { if (paragraph.length) { section.paragraphs!.push(paragraph.join("\n")); paragraph = []; } };
  for (const line of content.replace(/\r/g, "").split("\n")) {
    if (/^#{1,3}\s+/.test(line)) {
      flush(); if (section.heading || section.paragraphs!.length || section.items!.length) sections.push(section);
      section = { heading: line.replace(/^#{1,3}\s+/, ""), paragraphs: [], items: [] };
    } else if (/^-\s+/.test(line)) { flush(); section.items!.push(line.replace(/^-\s+/, "")); }
    else if (!line.trim()) flush();
    else {
      // A paragraph after a list must stay after that list in the reader.
      if (section.items!.length) { sections.push(section); section = { heading: "", paragraphs: [], items: [] }; }
      paragraph.push(line);
    }
  }
  flush(); if (section.heading || section.paragraphs!.length || section.items!.length) sections.push(section);
  return sections;
}

export function documentDateLabel(value: string) {
  return new Date(value).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" });
}
