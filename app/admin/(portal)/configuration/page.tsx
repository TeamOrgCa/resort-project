"use client";

import { useEffect, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import { settingCategories, settingDefinitions } from "@/lib/settings/catalog";
import { useSettings } from "@/components/settings/SettingsProvider";
import type { SettingCategory, SettingDefinition, SettingValue } from "@/lib/settings/types";

const displayValue = (value: SettingValue) => typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);

export default function ConfigurationPage() {
  const { settings, isLoading, isRefreshing, error, save } = useSettings();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<SettingCategory>(settingCategories[0].key);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setDraft(Object.fromEntries(settingDefinitions.map((definition) => [definition.key, displayValue(settings[definition.key] ?? definition.defaultValue)])));
    }
  }, [isLoading, settings]);

  const parseValue = (definition: SettingDefinition): SettingValue => {
    const raw = draft[definition.key] ?? "";
    if (definition.input === "number") return Number(raw);
    if (definition.input === "toggle") return raw === "true";
    if (definition.input === "json") return JSON.parse(raw) as SettingValue;
    return raw;
  };

  const handleSave = async () => {
    setMessage(null);
    try {
      setSaving(true);
      await save(settingDefinitions.filter((definition) => definition.category === activeCategory).map((definition) => ({ key: definition.key, value: parseValue(definition) })));
      setMessage("Settings saved.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Check JSON values and try again.");
    } finally {
      setSaving(false);
    }
  };

  const definitions = settingDefinitions.filter((definition) => definition.category === activeCategory);

  return (
    <div>
      <AdminSectionHeader title="Configuration" subtitle="Manage the business rules, contact information, and notification preferences used by MarVille." />
      <section className="rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6">
        <div className="mb-6 flex gap-2 overflow-x-auto border-b border-neutral/10 pb-4">
          {settingCategories.map((category) => (
            <button key={category.key} type="button" onClick={() => setActiveCategory(category.key)} className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold ${activeCategory === category.key ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"}`}>
              {category.label}
            </button>
          ))}
        </div>
        {isLoading ? <p className="py-8 text-sm text-neutral/70">Loading configuration...</p> : null}
        {error ? <p className="rounded-lg bg-primary/5 px-4 py-3 text-sm text-neutral">{error}</p> : null}
        {!isLoading ? <div className="space-y-5">
          {definitions.map((definition) => (
            <label key={definition.key} className="block">
              <span className="font-semibold text-neutral">{definition.label}</span>
              <span className="mt-1 block text-xs text-neutral/60">{definition.description}</span>
              {definition.input === "textarea" || definition.input === "json" ? (
                <textarea value={draft[definition.key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [definition.key]: event.target.value }))} rows={definition.input === "json" ? 4 : 3} className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 font-mono text-sm text-neutral" />
              ) : (
                <input type={definition.input === "number" ? "number" : "text"} value={draft[definition.key] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, [definition.key]: event.target.value }))} className="mt-2 w-full rounded-lg border border-neutral/20 px-3 py-2 text-neutral" />
              )}
            </label>
          ))}
          <div className="flex items-center justify-between border-t border-neutral/10 pt-5">
            <p className="text-sm text-neutral/60">{message ?? (isRefreshing ? "Refreshing..." : "Changes apply to new workflows immediately.")}</p>
            <button type="button" disabled={saving} onClick={handleSave} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-base disabled:opacity-50">{saving ? "Saving..." : "Save changes"}</button>
          </div>
        </div> : null}
      </section>
    </div>
  );
}