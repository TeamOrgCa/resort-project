export const SERVICE_QUANTITY_CEILING = 10000;

export function serviceQuantityLimit(configured?: number | null, bookedQuantity = 0) {
  const limit = Number.isSafeInteger(configured) && Number(configured) >= 1 && Number(configured) <= SERVICE_QUANTITY_CEILING
    ? Number(configured) : SERVICE_QUANTITY_CEILING;
  return Math.max(limit, Math.min(SERVICE_QUANTITY_CEILING, Math.max(0, bookedQuantity)));
}

export function parseServiceSelections(input: unknown): { serviceId: string; quantity: number }[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) return null;
  const selected: { serviceId: string; quantity: number }[] = [], seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== "object" || typeof item.serviceId !== "string" || !item.serviceId || item.serviceId !== item.serviceId.trim()) return null;
    const serviceId = item.serviceId.toLowerCase(), quantity = item.quantity === undefined ? 1 : item.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > SERVICE_QUANTITY_CEILING || seen.has(serviceId)) return null;
    selected.push({ serviceId, quantity }); seen.add(serviceId);
  }
  return selected;
}

export function serviceQuantityError(
  selected: { serviceId: string; quantity?: number }[],
  catalog: { service_id: string; name?: string; max_quantity?: number | null }[],
  booked: { service_id: string; quantity: number }[] = [],
): string | null {
  const parsed = parseServiceSelections(selected);
  if (!parsed) return "Choose each service once, with a whole-number quantity from 1 to 10000.";
  for (const selection of parsed) {
    const service = catalog.find(item => item.service_id.toLowerCase() === selection.serviceId);
    const previous = booked.find(item => item.service_id.toLowerCase() === selection.serviceId);
    if (!service) {
      if (previous && selection.quantity <= previous.quantity) continue;
      return "A selected service is no longer available. Reload the catalog.";
    }
    const limit = serviceQuantityLimit(service.max_quantity, previous?.quantity);
    if (selection.quantity > limit) return `${service.name || "This service"} allows a maximum quantity of ${limit} per booking.`;
  }
  return null;
}
