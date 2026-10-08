import type { LegalSection } from "@/lib/legal/policies";

export default function LegalDocument({ sections }: { sections: LegalSection[] }) {
  return (
    <div className="space-y-6 text-sm leading-7 text-neutral/80">
      {sections.map((section) => (
        <section key={section.heading}>
          <h2 className="mb-2 text-base font-semibold text-neutral">{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => <p key={paragraph} className="mb-2">{paragraph}</p>)}
          {section.items && (
            <ul className="list-disc space-y-1 pl-6">
              {section.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
