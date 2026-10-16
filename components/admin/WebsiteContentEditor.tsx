"use client";

import { useState } from "react";
import SettingEditor from "@/components/admin/SettingEditor";
import { contentFieldDefinition, contentSections } from "@/lib/settings/content-layout";
import type { SettingDefinition, SettingsMap, SettingValue } from "@/lib/settings/types";

export default function WebsiteContentEditor({ group, definitions, values, disabled, onChange, onUploadingChange }: {
  group: NonNullable<SettingDefinition["group"]>;
  definitions: SettingDefinition[];
  values: SettingsMap;
  disabled: boolean;
  onChange: (key: string, value: SettingValue) => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const [sectionId, setSectionId] = useState("");
  const sections = contentSections(group, definitions);
  const section = sections.find(item => item.id === sectionId) ?? sections[0];
  if (!section) return null;
  const textFields = section.definitions.filter(definition => definition.input !== "image");
  const imageFields = section.definitions.filter(definition => definition.input === "image");
  const editor = (definition: SettingDefinition) => <SettingEditor compact definition={contentFieldDefinition(definition)} value={values[definition.key] ?? definition.defaultValue} onChange={value => onChange(definition.key, value)} onUploadingChange={onUploadingChange} />;

  return <div className="space-y-3">
    {sections.length > 1 && <nav aria-label={`${group} content sections`} className="flex flex-wrap gap-1 border-b border-neutral/10 pb-2">
      {sections.map(item => <button key={item.id} type="button" disabled={disabled} aria-pressed={section.id === item.id} onClick={() => setSectionId(item.id)} className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${section.id === item.id ? "bg-primary/10 text-primary" : "text-neutral/65 hover:bg-base hover:text-neutral"}`}>{item.label}</button>)}
    </nav>}
    <section aria-label={`${group}: ${section.label}`} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral">{section.label}</h2>
        <a href={group === "About page" ? "/about" : "/"} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">Preview page <span aria-hidden="true">↗</span></a>
      </div>
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        {textFields.length > 0 && <div className="grid items-start gap-4 sm:grid-cols-2">
          {textFields.map(definition => <div key={definition.key} className={`min-w-0 ${["inclusions", "reminders"].includes(definition.key.split(".").at(-1) ?? "") ? "sm:col-span-2" : ""}`}>{editor(definition)}</div>)}
        </div>}
        {imageFields.length > 0 && <div><h3 className="mb-2 text-sm font-semibold text-neutral">Images</h3><div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {imageFields.map(definition => <div key={definition.key} className="min-w-0 rounded-lg border border-neutral/10 p-3">{editor(definition)}</div>)}
        </div></div>}
      </fieldset>
    </section>
  </div>;
}
