import type { SupabaseClient } from "@supabase/supabase-js";
import { settingDefinitions } from "./catalog";
import type { BusinessSetting, SettingValue, SettingsMap, SettingsUpdate } from "./types";

type SettingsDatabase = SupabaseClient;

export async function getAllSettings(supabase: SettingsDatabase): Promise<SettingsMap> {
  const { data, error } = await supabase
    .from("business_settings")
    .select("setting_key, setting_value, description, updated_at")
    .order("setting_key");

  if (error) throw new Error(error.message);

  const settings = Object.fromEntries(
    ((data as BusinessSetting[] | null) ?? []).map((setting) => [setting.setting_key, setting.setting_value])
  );

  for (const definition of settingDefinitions) {
    if (!(definition.key in settings)) {
      settings[definition.key] = definition.defaultValue;
    }
  }

  return settings;
}

export async function updateSettings(
  supabase: SettingsDatabase,
  updates: SettingsUpdate[]
): Promise<SettingsMap> {
  const rows = updates.map(({ key, value }) => ({
    setting_key: key,
    setting_value: value as SettingValue,
    description: settingDefinitions.find((definition) => definition.key === key)?.description ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase.from("business_settings").upsert(rows, { onConflict: "setting_key" });
  if (error) throw new Error(error.message);

  return getAllSettings(supabase);
}