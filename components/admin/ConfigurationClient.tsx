"use client";

import { useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import PolicyEditor from "@/components/admin/PolicyEditor";
import SettingEditor from "@/components/admin/SettingEditor";
import { settingCategories, settingDefinitions } from "@/lib/settings/catalog";
import { useSettings } from "@/components/settings/SettingsProvider";
import type { SettingCategory, SettingValue, SettingsMap } from "@/lib/settings/types";

export default function ConfigurationClient() {
  const { settings, isLoading, isRefreshing, error, save } = useSettings();
  const [draft, setDraft] = useState<SettingsMap>({});
  const [activeCategory, setActiveCategory] = useState<SettingCategory>(settingCategories[0].key);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(0);
  const [contentGroup, setContentGroup] = useState("Branding");
  const definitions = settingDefinitions.filter((definition) => definition.category === activeCategory && (activeCategory !== "content" || definition.group === contentGroup));

  const handleSave = async () => {
    setMessage(null);
    setSaving(true);
    try {
      await save(definitions.map((definition) => ({ key: definition.key, value: draft[definition.key] ?? settings[definition.key] ?? definition.defaultValue })));
      setDraft((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !definitions.some((definition) => definition.key === key))));
      setMessage("Settings saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  };

  return <div>
    <AdminSectionHeader title="Configuration" subtitle="Manage resort information, policies, and operational settings." />
    <section className="rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6">
      <div className="mb-6 flex gap-2 overflow-x-auto border-b border-neutral/10 pb-4">
        {settingCategories.map((category) => <button key={category.key} type="button" disabled={saving || uploadingImages > 0} onClick={() => { setActiveCategory(category.key); setMessage(null); }} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${activeCategory === category.key ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"}`}>
          {category.label}
        </button>)}
      </div>
      {isLoading && <p className="py-8 text-sm text-neutral/70">Loading configuration...</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!isLoading && <div className="space-y-5">
        {activeCategory === "content" && <div className="space-y-3">
          <p className="text-sm text-neutral/70">Edit the guest website images and text. Save each section to publish its changes. Contact details and social links are under Resort information.</p>
          <div className="flex flex-wrap gap-2">{["Branding", "Home page", "About page"].map((group) => <button key={group} type="button" disabled={saving || uploadingImages > 0} onClick={() => { setContentGroup(group); setMessage(null); }} className={`rounded-lg border px-4 py-2 text-sm ${contentGroup === group ? "border-primary bg-primary/10 font-semibold" : "border-neutral/20"}`}>{group}</button>)}</div>
          <a href={contentGroup === "About page" ? "/about" : "/"} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-primary underline">Open guest page</a>
        </div>}
        {activeCategory === "reservation" && <PolicyEditor />}
        <fieldset disabled={saving} className="space-y-5">
          {definitions.map((definition) => <SettingEditor key={definition.key} definition={definition} value={draft[definition.key] ?? settings[definition.key] ?? definition.defaultValue} onChange={(value: SettingValue) => setDraft((current) => ({ ...current, [definition.key]: value }))} onUploadingChange={(uploading) => setUploadingImages((count) => Math.max(0, count + (uploading ? 1 : -1)))} />)}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-5">
          <p className="text-sm text-neutral/60">{message ?? (isRefreshing ? "Refreshing..." : "Changes apply to new workflows immediately.")}</p>
          <button type="button" disabled={saving || uploadingImages > 0 || Boolean(error)} onClick={() => void handleSave()} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-base disabled:opacity-50">{saving ? "Saving..." : uploadingImages > 0 ? "Uploading image..." : activeCategory === "content" ? `Save ${contentGroup.toLowerCase()}` : "Save other settings"}</button>
        </div>
      </div>}
    </section>
  </div>;
}
