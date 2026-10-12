import { catalogResources, isCatalogUuid, type CatalogDefinition, type CatalogRecord, type CatalogResource } from "./catalog";
import { isContentImageUrl } from "@/lib/settings/public-content";

export class CatalogValidationError extends Error {}

export function validateCatalogRecord(resource: CatalogResource, input: unknown, existing?: CatalogRecord): CatalogRecord {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CatalogValidationError("Enter a valid catalog record.");
  const record = input as CatalogRecord;
  const definition: CatalogDefinition = catalogResources[resource];
  const allowedKeys = new Set(definition.fields.map((field) => field.key));
  if (!Object.keys(record).length || Object.keys(record).some((key) => !allowedKeys.has(key))) throw new CatalogValidationError("The record contains an unsupported field.");
  const merged = { ...existing, ...record };
  const result: CatalogRecord = {};

  for (const field of definition.fields) {
    let value = merged[field.key];
    if (value === undefined || value === null || value === "" || (typeof value === "string" && !value.trim())) {
      if (field.required) throw new CatalogValidationError(`${field.label} is required.`);
      value = field.defaultValue ?? null;
    }
    if (value === null) { result[field.key] = null; continue; }
    if (field.kind === "money" || field.kind === "integer") {
      if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value.trim()))) throw new CatalogValidationError(`Enter a valid ${field.label.toLowerCase()}.`);
      const number = Number(value);
      if (!Number.isFinite(number) || number < (field.min ?? 0) || number > (field.kind === "integer" ? 2147483647 : 99999999.99) ||
          (field.kind === "integer" && !Number.isInteger(number)) || (field.kind === "money" && Math.abs(number * 100 - Math.round(number * 100)) > 0.000001)) {
        throw new CatalogValidationError(`${field.label} must be ${field.kind === "integer" ? "a whole number" : "a price with at most two decimal places"} of at least ${field.min ?? 0}.`);
      }
      result[field.key] = number;
      continue;
    }
    if (typeof value !== "string") throw new CatalogValidationError(`Enter a valid ${field.label.toLowerCase()}.`);
    const text = value.trim();
    if (text.length > (field.kind === "textarea" ? 10000 : field.kind === "image" ? 2048 : 200)) throw new CatalogValidationError(`${field.label} is too long.`);
    if ((field.kind === "unit" || field.kind === "payment_method") && !isCatalogUuid(text)) throw new CatalogValidationError(`Select a valid ${field.label.toLowerCase()}.`);
    if (field.kind === "image" && !isContentImageUrl(text)) throw new CatalogValidationError("Use an HTTPS image URL or a local image path.");
    if (field.kind === "date") {
      const date = new Date(`${text}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number(text.slice(0, 4)) < 1 || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new CatalogValidationError(`Enter a valid ${field.label.toLowerCase()}.`);
    }
    if (field.kind === "time" && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text)) throw new CatalogValidationError(`Enter a valid ${field.label.toLowerCase()}.`);
    result[field.key] = field.kind === "time" && text.length === 5 ? `${text}:00` : text;
  }

  if (result.effective_to && String(result.effective_to) < String(result.effective_from)) throw new CatalogValidationError("End date must be on or after the start date.");
  if (resource === "ocular_time_slots" && String(result.end_time) <= String(result.start_time)) throw new CatalogValidationError("End time must be later than start time.");
  return result;
}
