"use client";

import { useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTabs from "@/components/admin/AdminTabs";
import PolicyEditor from "@/components/admin/PolicyEditor";
import SettingEditor from "@/components/admin/SettingEditor";
import WebsiteContentEditor from "@/components/admin/WebsiteContentEditor";
import { settingCategories, settingDefinitions } from "@/lib/settings/catalog";
import { useSettings } from "@/components/settings/SettingsProvider";
import type { SettingCategory, SettingDefinition, SettingValue, SettingsMap } from "@/lib/settings/types";

export default function ConfigurationClient() {
  const { settings, isLoading, isRefreshing, error, save } = useSettings();
  const [draft, setDraft] = useState<SettingsMap>({});
  const [activeCategory, setActiveCategory] = useState<SettingCategory>(settingCategories[0].key);
  const [message, setMessage] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(0);
  const [contentGroup, setContentGroup] = useState<NonNullable<SettingDefinition["group"]>>("Branding");
  const definitions = settingDefinitions.filter((definition) => definition.category === activeCategory && (activeCategory !== "content" || definition.group === contentGroup));
  const contentChanges = definitions.filter(definition => definition.key in draft && JSON.stringify(draft[definition.key]) !== JSON.stringify(settings[definition.key] ?? definition.defaultValue)).length;

  const handleSave = async () => {
    setMessage(null);
    setSaveFailed(false);
    setSaving(true);
    try {
      await save(definitions.map((definition) => ({ key: definition.key, value: draft[definition.key] ?? settings[definition.key] ?? definition.defaultValue })));
      setDraft((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !definitions.some((definition) => definition.key === key))));
      setMessage("Settings saved.");
    } catch (cause) {
      setSaveFailed(true);
      setMessage(cause instanceof Error ? cause.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  };

  return <div>
    <AdminSectionHeader title="Configuration" subtitle="Manage resort information, policies, and operational settings." />
    <section className="admin-panel">
      <AdminTabs tabs={settingCategories.map(category => category.label)} value={settingCategories.find(category => category.key === activeCategory)?.label ?? ""} label="Configuration sections" disabled={saving || uploadingImages > 0} onChange={label => { const category = settingCategories.find(item => item.label === label); if (category) { setActiveCategory(category.key); setMessage(null); } }} />
      {message && <p role={saveFailed ? "alert" : "status"} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${saveFailed ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>{message}</p>}
      {isLoading && <p className="py-8 text-sm text-neutral/70">Loading configuration...</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!isLoading && <div className={activeCategory === "content" ? "space-y-4" : "space-y-5"}>
        {activeCategory === "content" && <div>
          <div role="group" aria-label="Website page" className="flex flex-wrap gap-2">{(["Branding", "Home page", "About page"] as const).map((group) => <button key={group} type="button" aria-pressed={contentGroup === group} disabled={saving || uploadingImages > 0} onClick={() => { setContentGroup(group); setMessage(null); }} className={`min-h-11 rounded-xl border px-4 py-2 text-sm ${contentGroup === group ? "border-primary bg-primary/10 font-semibold text-primary" : "border-neutral/20 text-neutral/65 hover:bg-base"}`}>{group}</button>)}</div>
        </div>}
        {activeCategory === "reservation" && <PolicyEditor />}
        {activeCategory === "content" ? <WebsiteContentEditor key={contentGroup} group={contentGroup} definitions={definitions} values={{ ...settings, ...draft }} disabled={saving || uploadingImages > 0} onChange={(key, value) => setDraft(current => ({ ...current, [key]: value }))} onUploadingChange={uploading => setUploadingImages(count => Math.max(0, count + (uploading ? 1 : -1)))} /> : <fieldset disabled={saving} className="space-y-5">
          {definitions.map((definition) => <SettingEditor key={definition.key} definition={definition} value={draft[definition.key] ?? settings[definition.key] ?? definition.defaultValue} onChange={(value: SettingValue) => setDraft((current) => ({ ...current, [definition.key]: value }))} onUploadingChange={(uploading) => setUploadingImages((count) => Math.max(0, count + (uploading ? 1 : -1)))} />)}
        </fieldset>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-5">
          <p className="text-sm text-neutral/60">{isRefreshing ? "Refreshing..." : activeCategory === "content" ? contentChanges ? `${contentChanges} unsaved ${contentChanges === 1 ? "change" : "changes"}. Save publishes all sections in ${contentGroup.toLowerCase()}.` : "Choose a section to edit its text and images." : "Changes apply to new workflows immediately."}</p>
          <button type="button" disabled={saving || uploadingImages > 0 || Boolean(error)} onClick={() => void handleSave()} className="admin-button-primary">{saving ? "Saving..." : uploadingImages > 0 ? "Uploading image..." : activeCategory === "content" ? `Save ${contentGroup.toLowerCase()}` : "Save other settings"}</button>
        </div>
      </div>}
    </section>
  </div>;
}
