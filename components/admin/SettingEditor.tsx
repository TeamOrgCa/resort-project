"use client";

import type { SettingDefinition, SettingValue } from "@/lib/settings/types";

const fieldClass = "mt-2 w-full rounded-lg border border-neutral/20 bg-white px-3 py-2 text-sm text-neutral";
const asRecord = (value: SettingValue): Record<string, unknown> =>
  typeof value === "object" && !Array.isArray(value) && value !== null ? value : {};
const asList = (value: SettingValue): string[] => Array.isArray(value) ? value : [];

function ListEditor({ value, onChange, itemLabel }: { value: string[]; onChange: (value: string[]) => void; itemLabel: string }) {
  return <div className="mt-2 space-y-2">
    {value.map((item, index) => <div key={index} className="flex gap-2">
      <input aria-label={`${itemLabel} ${index + 1}`} value={item} onChange={(event) => onChange(value.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))} className={fieldClass.replace("mt-2 ", "")} />
      <button type="button" onClick={() => onChange(value.filter((_, entryIndex) => entryIndex !== index))} className="rounded-lg border border-neutral/20 px-3 text-sm">Remove</button>
    </div>)}
    <button type="button" onClick={() => onChange([...value, ""])} className="text-sm font-semibold text-primary underline">Add {itemLabel.toLowerCase()}</button>
  </div>;
}

function TemplatesEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const entries = Object.entries(value);
  return <div className="mt-2 space-y-3">
    {entries.map(([name, body]) => <div key={name} className="rounded-lg border border-neutral/10 bg-base p-3">
      <div className="flex gap-2">
        <input aria-label="Template name" value={name} onChange={(event) => {
          const nextName = event.target.value;
          if (nextName !== name && !(nextName in value)) onChange(Object.fromEntries(entries.map(([key, text]) => [key === name ? nextName : key, text])));
        }} className={fieldClass.replace("mt-2 ", "")} />
        <button type="button" onClick={() => onChange(Object.fromEntries(entries.filter(([key]) => key !== name)))} className="rounded-lg border border-neutral/20 px-3 text-sm">Remove</button>
      </div>
      <textarea aria-label={`${name} template body`} rows={3} value={typeof body === "string" ? body : ""} onChange={(event) => onChange({ ...value, [name]: event.target.value })} className={fieldClass} />
    </div>)}
    <button type="button" onClick={() => {
      let index = entries.length + 1;
      while (`New template ${index}` in value) index += 1;
      onChange({ ...value, [`New template ${index}`]: "" });
    }} className="text-sm font-semibold text-primary underline">Add template</button>
  </div>;
}

export default function SettingEditor({ definition, value, onChange }: { definition: SettingDefinition; value: SettingValue; onChange: (value: SettingValue) => void }) {
  const record = asRecord(value);
  let control: React.ReactNode;
  if (definition.key === "resort.contact_numbers" || definition.key === "payments.accepted_methods") {
    control = <ListEditor value={asList(value)} onChange={onChange} itemLabel={definition.key === "resort.contact_numbers" ? "Phone number" : "Payment method"} />;
  } else if (definition.key === "resort.social_links") {
    control = <div className="mt-2 grid gap-3 sm:grid-cols-3">{["facebook", "instagram", "tiktok"].map((platform) => <label key={platform} className="text-xs capitalize text-neutral/70">{platform}
      <input value={String(record[platform] ?? "")} onChange={(event) => onChange({ ...record, [platform]: event.target.value })} className={fieldClass} />
    </label>)}</div>;
  } else if (definition.key === "ocular.allowed_booking_window") {
    control = <div className="mt-2 grid gap-3 sm:grid-cols-2">{["start", "end"].map((part) => <label key={part} className="text-xs capitalize text-neutral/70">{part} time
      <input type="time" value={String(record[part] ?? "")} onChange={(event) => onChange({ ...record, [part]: event.target.value })} className={fieldClass} />
    </label>)}</div>;
  } else if (definition.key === "payments.receipt_settings") {
    control = <div className="mt-2 flex flex-wrap items-center gap-4">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={record.emailEnabled === true} onChange={(event) => onChange({ ...record, emailEnabled: event.target.checked })} /> Email receipts</label>
      <label className="text-xs text-neutral/70">Receipt prefix<input value={String(record.prefix ?? "")} onChange={(event) => onChange({ ...record, prefix: event.target.value })} className={fieldClass} /></label>
    </div>;
  } else if (definition.key === "notifications.email_templates" || definition.key === "notifications.sms_templates") {
    control = <TemplatesEditor value={record} onChange={onChange} />;
  } else if (definition.key === "notifications.admin_alert_preferences") {
    control = <div className="mt-2 flex flex-wrap gap-4">{[["email", "Email"], ["inApp", "In-app"], ["sms", "SMS"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={record[key] === true} onChange={(event) => onChange({ ...record, [key]: event.target.checked })} />{label}</label>)}</div>;
  } else if (definition.input === "toggle") {
    control = <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /> Enabled</label>;
  } else if (definition.input === "textarea") {
    control = <textarea rows={3} value={String(value)} onChange={(event) => onChange(event.target.value)} className={fieldClass} />;
  } else {
    control = <input type={definition.input === "number" ? "number" : "text"} value={String(value)} onChange={(event) => onChange(definition.input === "number" ? Number(event.target.value) : event.target.value)} className={fieldClass} />;
  }
  return <div className="rounded-xl border border-neutral/10 p-4">
    <p className="font-semibold text-neutral">{definition.label}</p>
    <p className="mt-1 text-xs text-neutral/60">{definition.description}</p>
    {control}
  </div>;
}
