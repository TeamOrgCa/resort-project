export type CatalogRecord = Record<string, unknown>;
export type CatalogStatus = "active" | "archived" | "all";
export type CatalogFieldKind = "text" | "textarea" | "money" | "integer" | "date" | "time" | "image" | "unit" | "payment_method" | "select";

export interface CatalogField {
  key: string;
  label: string;
  kind: CatalogFieldKind;
  required?: boolean;
  min?: number;
  max?: number;
  minTime?: string;
  maxTime?: string;
  defaultValue?: number | string;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface CatalogDefinition {
  label: string;
  singular: string;
  description: string;
  id: string;
  select: string;
  order: string;
  search?: string;
  columns: string[];
  fields: CatalogField[];
}

export const catalogResources = {
  promo_codes: {
    label: "Promos / vouchers", singular: "promo code", description: "Create or archive voucher codes. Discounts apply to the package price; only the larger of the promo and eligible PWD/senior discount is used.",
    id: "promo_id", select: "promo_id,code,discount_type,discount_value,max_uses,starts_at,ends_at,is_active,created_at", order: "code", search: "code",
    columns: ["code", "discount_type", "discount_value", "max_uses", "usage_count", "pending_uses", "remaining_uses", "starts_at", "ends_at"], fields: [
      { key: "code", label: "Promo / voucher code", kind: "text", required: true },
      { key: "discount_type", label: "Discount type", kind: "select", defaultValue: "percent", options: [{ value: "percent", label: "Percentage of package price" }, { value: "fixed", label: "Fixed peso discount" }] },
      { key: "discount_value", label: "Discount value (% or PHP)", kind: "money", required: true, min: 0.01 },
      { key: "max_uses", label: "Maximum successful reservations", kind: "integer", min: 1, help: "Optional. Leave blank for unlimited uses, or enter a total limit such as 5. One use is counted when a booking is confirmed and the promo wins. Pending bookings hold a slot until confirmed, cancelled or expired. Confirmed uses are not restored by later cancellations." },
      { key: "starts_at", label: "Valid from (PH)", kind: "date" },
      { key: "ends_at", label: "Valid until (PH)", kind: "date" },
    ],
  },
  services: {
    label: "Services", singular: "service", description: "Manage the extras guests can add to their stay.",
    id: "service_id", select: "service_id, name, description, image_url, billing_type, price, max_quantity, is_active, created_at", order: "name", search: "name",
    columns: ["name", "billing_type", "price", "max_quantity"], fields: [
      { key: "name", label: "Service name", kind: "text", required: true },
      { key: "billing_type", label: "Service type", kind: "select", defaultValue: "quantity", options: [{ value: "duration", label: "Per Hour" }, { value: "quantity", label: "Per Piece" }, { value: "person", label: "Per Person" }, { value: "fixed", label: "Fixed Rate" }], help: "Choose how this service is charged. Fixed rates have one charge unless multiple bookings are allowed." },
      { key: "price", label: "Price (PHP)", kind: "money", required: true, min: 0 },
      { key: "max_quantity", label: "Maximum per booking", kind: "integer", required: true, min: 1, max: 10000, defaultValue: 1, help: "Set the maximum hours, pieces, guests or bookings. For a single fixed-rate charge, set this to 1. A higher value allows multiple bookings." },
      { key: "description", label: "Description", kind: "textarea" },
      { key: "image_url", label: "Service photo", kind: "image", help: "Upload or replace a photo, or remove it to use the default placeholder. Save changes to publish." },
    ],
  },
  units: {
    label: "Units", singular: "unit", description: "Keep accommodation details, capacity, and images up to date.",
    id: "unit_id", select: "unit_id, unit_img, name, description, capacity, base_price, is_active, archived_at", order: "name", search: "name",
    columns: ["name", "capacity", "base_price"], fields: [
      { key: "name", label: "Unit name", kind: "text", required: true },
      { key: "capacity", label: "Guest capacity", kind: "integer", required: true, min: 1 },
      { key: "base_price", label: "Base price (PHP)", kind: "money", required: true, min: 0 },
      { key: "unit_img", label: "Unit photo", kind: "image", help: "Upload or replace the photo guests see when choosing a room. Save changes to publish, or remove it to use the room placeholder." },
      { key: "description", label: "Description", kind: "textarea" },
    ],
  },
  unit_rates: {
    label: "Unit rates", singular: "unit rate", description: "Manage dated rate records for each unit.",
    id: "unit_rate_id", select: "unit_rate_id, unit_id, price, effective_from, effective_to, is_active, created_at", order: "effective_from",
    columns: ["unit_id", "price", "effective_from", "effective_to"], fields: [
      { key: "unit_id", label: "Unit", kind: "unit", required: true },
      { key: "price", label: "Rate (PHP)", kind: "money", required: true, min: 0 },
      { key: "effective_from", label: "Start date", kind: "date", required: true },
      { key: "effective_to", label: "End date", kind: "date", help: "Leave blank for no end date." },
    ],
  },
  guest_rates: {
    label: "Guest rates", singular: "guest rate", description: "Manage adult and child rate records and their effective dates.",
    id: "rate_id", select: "rate_id, adult_rate, child_rate, effective_from, effective_to, is_active, created_at", order: "effective_from",
    columns: ["adult_rate", "child_rate", "effective_from", "effective_to"], fields: [
      { key: "adult_rate", label: "Adult rate (PHP)", kind: "money", required: true, min: 0 },
      { key: "child_rate", label: "Child rate (PHP)", kind: "money", required: true, min: 0 },
      { key: "effective_from", label: "Start date", kind: "date", required: true },
      { key: "effective_to", label: "End date", kind: "date", help: "Leave blank for no end date." },
    ],
  },
  payment_methods: {
    label: "Payment methods", singular: "payment method", description: "Manage payment channels and link active receiving accounts. GCash supports receipt verification; other online methods require cashier approval. Cash is for staff-recorded payments at the resort.",
    id: "payment_method_id", select: "payment_method_id, name, type, is_active, created_at", order: "name", search: "name",
    columns: ["name", "type"], fields: [
      { key: "name", label: "Method name", kind: "text", required: true },
      { key: "type", label: "Payment type", kind: "text", required: true, help: "For example: bank, ewallet, or cash. Use bank for bank transfers." },
    ],
  },
  payment_accounts: {
    label: "Payment accounts", singular: "payment account", description: "Manage receiving account details, instructions, and QR images.",
    id: "account_id", select: "account_id, payment_method_id, account_name, account_number, qr_image, instructions, is_active, created_at", order: "account_name", search: "account_name",
    columns: ["account_name", "payment_method_id", "account_number"], fields: [
      { key: "payment_method_id", label: "Payment method", kind: "payment_method", required: true },
      { key: "account_name", label: "Account name", kind: "text", required: true },
      { key: "account_number", label: "Account number", kind: "text", help: "Keep any leading zeroes." },
      { key: "instructions", label: "Payment instructions", kind: "textarea" },
    ],
  },
  reservation_policies: {
    label: "Policies", singular: "policy", description: "Publish versioned Terms and Conditions and Privacy Policy documents.",
    id: "policy_id", select: "policy_id, title, content, display_order, is_active, updated_at", order: "display_order", search: "title",
    columns: ["title", "content", "display_order"], fields: [
      { key: "title", label: "Policy title", kind: "text", required: true },
      { key: "display_order", label: "Display order", kind: "integer", min: 0, defaultValue: 0, help: "Lower numbers appear first." },
      { key: "content", label: "Policy text", kind: "textarea", required: true },
    ],
  },
  ocular_time_slots: {
    label: "Ocular slots", singular: "ocular slot", description: "Manage resort visits between 8:00 AM and 5:00 PM (Philippine time).",
    id: "slot_id", select: "slot_id, start_time, end_time, max_capacity, is_active", order: "start_time",
    columns: ["start_time", "end_time", "max_capacity"], fields: [
      { key: "start_time", label: "Start time", kind: "time", required: true, minTime: "08:00", maxTime: "17:00", help: "Between 8:00 AM and 5:00 PM (Philippine time)." },
      { key: "end_time", label: "End time", kind: "time", required: true, minTime: "08:00", maxTime: "17:00", help: "Later than the start time and no later than 5:00 PM." },
      { key: "max_capacity", label: "Visit capacity", kind: "integer", min: 1, defaultValue: 1 },
    ],
  },
} satisfies Record<string, CatalogDefinition>;

export type CatalogResource = keyof typeof catalogResources;
export const catalogResourceKeys = Object.keys(catalogResources) as CatalogResource[];
export function isCatalogResource(value: unknown): value is CatalogResource {
  return typeof value === "string" && Object.hasOwn(catalogResources, value);
}
export function isCatalogUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function isCatalogActive(record: CatalogRecord): boolean { return record.is_active === true && !record.archived_at; }

export function catalogRecordName(resource: CatalogResource, record: CatalogRecord, references?: CatalogReferences): string {
  if (resource === "unit_rates") return `${references?.units.find((unit) => unit.unit_id === record.unit_id)?.name ?? "Unit"} rate`;
  if (resource === "guest_rates") return `Guest rate from ${record.effective_from ?? "unspecified date"}`;
  if (resource === "ocular_time_slots") return `${String(record.start_time ?? "").slice(0, 5)} – ${String(record.end_time ?? "").slice(0, 5)}`;
  return String(record.name ?? record.code ?? record.account_name ?? record.title ?? catalogResources[resource].singular);
}

export interface CatalogReferences {
  units: Array<{ unit_id: string; name: string; is_active: boolean; archived_at: string | null }>;
  paymentMethods: Array<{ payment_method_id: string; name: string; type?: string; is_active: boolean }>;
}
