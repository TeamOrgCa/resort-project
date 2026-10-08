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
  const definitions = settingDefinitions.filter((definition) => definition.category === activeCategory);

  const handleSave = async () => {
    setMessage(null);
    setSaving(true);
    try {
      await save(definitions.map((definition) => ({ key: definition.key, value: draft[definition.key] ?? settings[definition.key] ?? definition.defaultValue })));
      setDraft({});
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
        {settingCategories.map((category) => <button key={category.key} type="button" onClick={() => { setActiveCategory(category.key); setMessage(null); }} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${activeCategory === category.key ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"}`}>
          {category.label}
        </button>)}
      </div>
      {isLoading && <p className="py-8 text-sm text-neutral/70">Loading configuration...</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {!isLoading && <div className="space-y-5">
        {activeCategory === "reservation" && <PolicyEditor />}
        {definitions.map((definition) => <SettingEditor key={definition.key} definition={definition} value={draft[definition.key] ?? settings[definition.key] ?? definition.defaultValue} onChange={(value: SettingValue) => setDraft((current) => ({ ...current, [definition.key]: value }))} />)}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-5">
          <p className="text-sm text-neutral/60">{message ?? (isRefreshing ? "Refreshing..." : "Changes apply to new workflows immediately.")}</p>
          <button type="button" disabled={saving || Boolean(error)} onClick={() => void handleSave()} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-base disabled:opacity-50">{saving ? "Saving..." : "Save other settings"}</button>
        </div>
      </div>}
    </section>
  </div>;
}
