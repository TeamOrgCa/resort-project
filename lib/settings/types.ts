export type SettingValue = string | number | boolean | string[] | Record<string, unknown>;

export type SettingCategory =
  | "resort"
  | "reservation"
  | "ocular"
  | "payments"
  | "notifications";

export interface BusinessSetting {
  setting_key: string;
  setting_value: SettingValue;
  description: string | null;
  updated_at: string | null;
}

export interface SettingsMap {
  [key: string]: SettingValue;
}

export interface SettingDefinition {
  key: string;
  category: SettingCategory;
  label: string;
  description: string;
  input: "text" | "number" | "toggle" | "textarea" | "json";
  defaultValue: SettingValue;
}

export interface SettingsUpdate {
  key: string;
  value: SettingValue;
}