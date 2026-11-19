import { catalogResources, type CatalogRecord, type CatalogResource } from "./catalog";

export const catalogNameKey = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
export const namedCatalogResources = ["services", "units", "payment_methods"] as const;
const slotTimeKey = (value: unknown) => String(value).length === 5 ? `${value}:00` : String(value);

export function catalogDuplicateMessage(resource: CatalogResource): string | null {
  if (resource === "ocular_time_slots") return "An ocular time slot with the same start and end times already exists. Edit or restore the existing slot instead.";
  return namedCatalogResources.some(name => name === resource)
    ? `A ${catalogResources[resource].singular} with this name already exists. Edit or restore the existing item instead.` : null;
}

export function isCatalogDuplicate(resource: CatalogResource, record: CatalogRecord, other: CatalogRecord): boolean {
  if (resource === "ocular_time_slots") return slotTimeKey(record.start_time) === slotTimeKey(other.start_time)
    && slotTimeKey(record.end_time) === slotTimeKey(other.end_time);
  return namedCatalogResources.some(name => name === resource) && catalogNameKey(record.name) === catalogNameKey(other.name);
}
