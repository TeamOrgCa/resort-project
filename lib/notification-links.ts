export function ocularVisitDetailsUrl(visitId?: string | null) {
  return `/manage?tab=ocular${visitId ? `&visit=${encodeURIComponent(visitId)}` : ""}`;
}

export function reservationDetailsUrl(entityType: string, entityId: string) {
  const parameter = entityType === "payment" ? "payment" : entityType === "reservation_reschedule" ? "reschedule" : "reservation";
  return `/manage?tab=bookings&${parameter}=${encodeURIComponent(entityId)}`;
}

/** Resolve historical notification links without rewriting saved records. */
export function notificationActionUrl(item: { action_url: string | null; entity_type?: string | null; entity_id?: string | null }) {
  const href = item.action_url;
  if (!href?.startsWith("/") || href.startsWith("//")) return null;
  const path = href.split(/[?#]/)[0];
  if (path === "/admin/reservations" && item.entity_id && ["reservation", "reservation_reschedule"].includes(item.entity_type ?? "")) {
    const url = new URL(href, "https://resort.invalid");
    url.searchParams.delete("reservation");
    url.searchParams.delete("reschedule");
    url.searchParams.delete("highlight");
    url.searchParams.set(item.entity_type === "reservation_reschedule" ? "reschedule" : "reservation", item.entity_id);
    url.searchParams.set("highlight", "1");
    return `${url.pathname}${url.search}${url.hash}`;
  }
  if (path === "/ocular" || (path === "/manage" && item.entity_type === "ocular_visit")) {
    return ocularVisitDetailsUrl(item.entity_id);
  }
  if (path === "/manage" && item.entity_id && ["reservation", "payment", "reservation_reschedule"].includes(item.entity_type ?? "")) {
    return reservationDetailsUrl(item.entity_type!, item.entity_id);
  }
  return href;
}
