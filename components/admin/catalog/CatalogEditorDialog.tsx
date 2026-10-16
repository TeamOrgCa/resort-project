"use client";

import { useState } from "react";
import { catalogResources, isCatalogActive, type CatalogDefinition, type CatalogRecord, type CatalogReferences, type CatalogResource } from "@/lib/catalog/catalog";
import CatalogDialog from "./CatalogDialog";

interface Props {
  resource: CatalogResource;
  record: CatalogRecord | null;
  references: CatalogReferences;
  referencesError: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (draft: CatalogRecord, file: File | null) => Promise<void>;
}

const inputClass = "mt-1.5 w-full rounded-xl border border-neutral/20 bg-white px-3 py-2.5 text-sm font-normal text-neutral outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:bg-base disabled:text-neutral/50";

export default function CatalogEditorDialog({ resource, record, references, referencesError, busy, error, onClose, onSave }: Props) {
  const definition: CatalogDefinition = catalogResources[resource];
  const [draft, setDraft] = useState<CatalogRecord>(() => Object.fromEntries(definition.fields.map((field) => [field.key, record?.[field.key] ?? field.defaultValue ?? ""])));
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const needsReferences = resource === "unit_rates" || resource === "payment_accounts";
  const setField = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  return <CatalogDialog title={`${record ? "Edit" : "Add"} ${definition.singular}`} description={record ? "Update this record, then save your changes." : "Fill in the details below. Fields marked * are required."} busy={busy} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (!busy && !fileError) void onSave(draft, qrFile); }}>
      {record && !isCatalogActive(record) && <p className="mb-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">This record is archived. Saving edits keeps it archived; use Restore to make it active again.</p>}
      {resource === "guest_rates" && <p className="mb-5 rounded-xl bg-base px-4 py-3 text-sm text-neutral/70">Only one guest rate can be active. Adding a rate makes it active and archives the previous rate.</p>}
      {needsReferences && referencesError && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{referencesError} Close this dialog and refresh the catalog to try again.</p>}
      <fieldset disabled={busy} className="grid gap-5 sm:grid-cols-2">
        {definition.fields.map((field, index) => {
          const value = String(draft[field.key] ?? "");
          let control;
          if (field.kind === "unit" || field.kind === "payment_method") {
            const options = field.kind === "unit" ? references.units.map((unit) => ({ id: unit.unit_id, name: unit.name, active: unit.is_active && !unit.archived_at })) : references.paymentMethods.map((method) => ({ id: method.payment_method_id, name: method.name, active: method.is_active }));
            const choices = options.filter((option) => option.active || option.id === record?.[field.key]);
            control = <select id={`catalog-${field.key}`} data-autofocus={index === 0 ? true : undefined} required={field.required} value={value} onChange={(event) => setField(field.key, event.target.value)} className={inputClass}>
              <option value="">Select {field.label.toLowerCase()}</option>
              {choices.map((option) => <option key={option.id} value={option.id} disabled={!option.active}>{option.name}{!option.active ? " (archived)" : ""}</option>)}
              {value && !options.some((option) => option.id === value) && <option value={value} disabled>Unavailable linked record</option>}
            </select>;
          } else if (field.kind === "textarea") {
            control = <textarea id={`catalog-${field.key}`} rows={field.key === "content" ? 6 : 4} required={field.required} maxLength={10000} value={value} onChange={(event) => setField(field.key, event.target.value)} className={inputClass} />;
          } else {
            const type = field.kind === "money" || field.kind === "integer" ? "number" : field.kind === "date" || field.kind === "time" ? field.kind : "text";
            control = <input id={`catalog-${field.key}`} data-autofocus={index === 0 ? true : undefined} type={type} required={field.required} min={field.kind === "date" && field.key === "effective_to" ? String(draft.effective_from ?? "") : field.min} step={field.kind === "money" ? "0.01" : field.kind === "integer" ? "1" : undefined} maxLength={type === "text" ? field.kind === "image" ? 2048 : 200 : undefined} value={value} onChange={(event) => setField(field.key, event.target.value)} className={inputClass} />;
          }
          return <div key={field.key} className={field.kind === "textarea" || field.kind === "image" ? "sm:col-span-2" : ""}>
            <label htmlFor={`catalog-${field.key}`} className="text-sm font-medium text-neutral">{field.label}{field.required && <span className="ml-1 text-primary" aria-label="required">*</span>}</label>
            {control}
            {field.help && <p className="mt-1.5 text-xs leading-relaxed text-neutral/55">{field.help}</p>}
          </div>;
        })}
        {resource === "payment_accounts" && <div className="sm:col-span-2 rounded-xl border border-dashed border-neutral/20 bg-base/50 p-4">
          <label htmlFor="catalog-qr" className="text-sm font-medium text-neutral">Payment QR image <span className="text-primary" aria-label="required">*</span></label>
          <p className="mt-1 text-xs text-neutral/60">{record?.qr_image ? "A QR image is already attached. Choose a file to replace it." : "Required. Upload the QR guests will scan to pay. PNG, JPEG, or WebP up to 5 MB."}</p>
          <input id="catalog-qr" type="file" required={!record?.qr_image} accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (file && (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size)) { setFileError("Choose a PNG, JPEG, or WebP image up to 5 MB."); setQrFile(null); return; }
            setFileError(null); setQrFile(file);
          }} className="mt-3 block w-full text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-white file:px-3 file:py-2 file:font-medium" />
          {qrFile && <p className="mt-2 text-xs text-neutral/60">Selected: {qrFile.name}</p>}
          {fileError && <p role="alert" className="mt-2 text-sm text-red-700">{fileError}</p>}
        </div>}
      </fieldset>
      {error && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <div className="mt-6 flex justify-end gap-3 border-t border-neutral/10 pt-5">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-neutral/20 px-5 py-2.5 text-sm font-medium hover:bg-base disabled:opacity-40">Cancel</button>
        <button type="submit" disabled={busy || Boolean(fileError) || (needsReferences && Boolean(referencesError))} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50">{busy ? "Saving..." : record ? "Save changes" : `Add ${definition.singular}`}</button>
      </div>
    </form>
  </CatalogDialog>;
}
