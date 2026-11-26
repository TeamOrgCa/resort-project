"use client";
import { useEffect, useState } from "react";
import { availableRoomCount, type CustomerRoomCatalog } from "@/lib/booking/customer-rooms";
import { PRIVATE_SWIMMING_INCLUDED_ROOMS, swimmingRoomEnd, swimmingRoomDurationLabel, swimmingRoomsQuote, type SwimmingRoomSelection } from "@/lib/booking/swimming-rooms";

export function useSwimmingRooms(start: string, end: string, rooms: SwimmingRoomSelection[], privateSwimming: boolean, guestCount: number) {
  const [catalog, setCatalog] = useState<CustomerRoomCatalog | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!start || !end) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setCatalog(null);
    async function load() {
      try {
        const response = await fetch(`/api/booking/rooms?startDatetime=${encodeURIComponent(start)}&endDatetime=${encodeURIComponent(end)}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.classifications) || !Array.isArray(data.rooms)) throw new Error(data.message || "Unable to load rooms. Please refresh room availability.");
        if (!controller.signal.aborted) { setCatalog(data); setError(""); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load rooms."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [start, end, retry]);
  let quote: ReturnType<typeof swimmingRoomsQuote> | null = null, issue = error;
  if (catalog) { try { quote = swimmingRoomsQuote(catalog, rooms, start, end, privateSwimming, guestCount); } catch (e) { issue = e instanceof Error ? e.message : "Review your room choices."; } }
  return { catalog, loading, error: issue, quote, refresh: () => setRetry(n => n + 1) };
}
export default function SwimmingRoomSelection({ state, value, onChange, start, end, guestCount, privateSwimming = false }: {
  state: ReturnType<typeof useSwimmingRooms>; value: SwimmingRoomSelection[]; onChange: (rooms: SwimmingRoomSelection[]) => void;
  start: string; end: string; guestCount: number; privateSwimming?: boolean;
}) {
  const money = (n: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
  const sessionHours = (Date.parse(end) - Date.parse(start)) / 3600000;
  const maximumDuration = Math.max(0, Math.min(24, Math.floor(sessionHours)));
  const defaultDuration = privateSwimming ? Math.min(maximumDuration, 12) : maximumDuration;
  const assignedGuests = value.reduce((total, room) => total + (room.occupants ?? 1) * room.quantity, 0);
  const roomGuestLimit = (index: number, capacity: number) => Math.max(0, Math.min(capacity, guestCount - value.reduce((total, room, i) => total + (i === index ? 0 : (room.occupants ?? 1) * room.quantity), 0)));
  const standard = state.catalog?.classifications.find(c => c.code === "standard");
  const capacityKnown = state.catalog && (!privateSwimming || standard) && value.every(room => state.catalog!.classifications.some(c => c.classification_id === room.classificationId));
  const roomCapacity = (key: "included_capacity" | "maximum_capacity") => value.reduce((total, room) => total + Number(state.catalog?.classifications.find(c => c.classification_id === room.classificationId)?.[key] ?? 0) * room.quantity, privateSwimming ? Number(standard?.[key] ?? 0) * PRIVATE_SWIMMING_INCLUDED_ROOMS : 0);
  useEffect(() => {
    if (!state.catalog || !value.some(room => room.durationHours === undefined || room.occupants === undefined || room.quantity > 1)) return;
    onChange(value.flatMap(room => Array.from({ length: room.quantity }, () => ({ ...room, quantity: 1,
      occupants: room.occupants ?? 1, durationHours: room.durationHours ?? defaultDuration }))));
  }, [state.catalog, value, onChange, defaultDuration]);
  const newRoom = state.catalog?.classifications.flatMap(c => {
    const durations = [...new Set([defaultDuration, 3, 8, 12, Math.min(1, maximumDuration)])];
    for (const durationHours of durations) {
      const candidate: SwimmingRoomSelection = { classificationId: c.classification_id, quantity: 1, pricingVersion: Number(c.pricing_version), occupants: 1, durationHours };
      try { swimmingRoomsQuote(state.catalog!, [...value, candidate], start, end, privateSwimming, guestCount); return [candidate]; } catch { /* Try another configured duration or room type. */ }
    }
    return [];
  })[0];
  const updateRoom = (index: number, patch: Partial<SwimmingRoomSelection>) => onChange(value.map((room, i) => i === index ? { ...room, ...patch } : room));
  return <section data-booking-guide="guest-rooms" className="mb-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold text-neutral">Additional Rooms</h3><button type="button" disabled={state.loading} onClick={state.refresh} className="text-sm font-semibold text-primary underline">Refresh rooms</button></div>
    <p className="mb-4 text-sm text-neutral/70">{privateSwimming ? "Two Standard rooms are included at no extra charge for your swimming session. Add only the extra rooms you need below." : "Public admission does not include a room. Add a room if you need one, or continue without rooms."} Each additional room starts at swimming check-in. Choose its guests and an available room duration within your swimming session. Rooms and extensions must end by swimming checkout.</p>
    <p className="mb-4 text-sm text-neutral/70">Choose whole room hours within your swimming stay. Custom durations use the preceding 3-, 8- or 12-hour room rate plus the configured hourly extension rate. Shorter stays have a minimum 3-hour room charge.</p>
    {state.loading && <p role="status" className="text-sm text-neutral/70">Checking room availability...</p>}
    {state.error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    <p aria-live="polite" className="mb-4 text-sm text-neutral/70">Guests assigned to additional rooms: {assignedGuests} of {guestCount}. Combined room guests cannot exceed your booking&apos;s guest count.</p>
    {!state.loading && capacityKnown && (privateSwimming || value.length > 0) && <div aria-label="Total room capacity" aria-live="polite" className="mb-4 rounded-xl bg-primary/5 p-4 text-sm text-neutral">
      <p className="font-semibold">Total room capacity: up to {roomCapacity("maximum_capacity")} guests</p>
      <p className="mt-1 text-neutral/70">{roomCapacity("included_capacity")} guests included in the room rates. Extra guests are charged at the configured room rates.</p>
      {privateSwimming && <p className="mt-1 text-neutral/70">Includes the two Standard rooms in your private swimming package.</p>}
    </div>}
    <div className="space-y-4">{value.map((room, index) => {
      const c = state.catalog?.classifications.find(c => c.classification_id === room.classificationId);
      const quote = state.quote?.selections[index];
      const available = c && state.catalog ? availableRoomCount(state.catalog, c.classification_id, start, swimmingRoomEnd(start, end, room)) : 0;
      return <fieldset key={index} disabled={state.loading} className="rounded-xl border border-neutral/20 p-4 text-sm text-neutral">
        <legend className="px-2 text-base font-semibold">Additional Room {index + 1}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block font-medium">Room type<select aria-label={`Additional room ${index + 1} type`} required value={room.classificationId} className="mt-2 min-h-12 w-full rounded-lg border border-neutral/20 bg-white px-4 py-3" onChange={event => {
            const next = state.catalog?.classifications.find(c => c.classification_id === event.target.value);
            if (next) updateRoom(index, { classificationId: next.classification_id, pricingVersion: Number(next.pricing_version), occupants: Math.min(room.occupants ?? 1, roomGuestLimit(index, next.maximum_capacity)) });
          }}>{state.catalog?.classifications.map(c => <option key={c.classification_id} value={c.classification_id}>{c.name}</option>)}</select></label>
          <div><label className="block font-medium">Room duration (hours)<input aria-label={`Additional room ${index + 1} duration`} required type="number" inputMode="numeric" min={1} max={maximumDuration} step={1} value={room.durationHours ?? defaultDuration} className="mt-2 min-h-12 w-full rounded-lg border border-neutral/20 bg-white px-4 py-3" onKeyDown={event => { if ([".", ",", "e", "E", "+", "-"].includes(event.key)) event.preventDefault(); }} onChange={event => {
              if (!/^\d{0,2}$/.test(event.currentTarget.value)) { event.currentTarget.value = String(room.durationHours ?? defaultDuration); return; }
              updateRoom(index, { durationHours: Math.min(Number(event.currentTarget.value), maximumDuration), pricingVersion: Number(c?.pricing_version ?? room.pricingVersion) });
            }} /></label>
            <p className="mt-1 text-xs text-neutral/65">Whole hours only, up to {swimmingRoomDurationLabel(maximumDuration)} within your swimming stay.</p>
            <button type="button" aria-label={`Use maximum room hours for additional room ${index + 1}`} className="mt-2 min-h-11 font-semibold text-primary underline" onClick={() => updateRoom(index, { durationHours: maximumDuration, pricingVersion: Number(c?.pricing_version ?? room.pricingVersion) })}>Use maximum room hours</button>
          </div>
          <label className="block font-medium">Guests in this room<input aria-label={`Additional room ${index + 1} guests`} required type="number" inputMode="numeric" min={1} max={roomGuestLimit(index, c?.maximum_capacity ?? 0)} step={1} value={room.occupants ?? 1} className="mt-2 min-h-12 w-full rounded-lg border border-neutral/20 bg-white px-4 py-3" onChange={event => updateRoom(index, { occupants: Math.max(0, Math.min(Math.floor(Number(event.target.value)), roomGuestLimit(index, c?.maximum_capacity ?? 0))), pricingVersion: Number(c?.pricing_version ?? room.pricingVersion) })} /></label>
          {c && <div className="self-end text-neutral/70"><p>{c.included_capacity} guests included · Maximum {c.maximum_capacity}</p><p className="mt-1">{available} rooms available for this duration</p><p className="mt-1">Extra guest: {money(Number(c.additional_guest_rate || 0))} per person per room stay</p></div>}
        </div>
        {quote && <div aria-live="polite" className="mt-4 space-y-1 border-t border-neutral/10 pt-3"><p>Base accommodation ({quote.baseHours ?? room.durationHours} hours): {money(quote.baseRate ?? quote.accommodation ?? quote.unitPrice)}</p><p>Room extension ({quote.extensionHours ?? 0} billed hours at {money(quote.extensionHourlyRate ?? 0)}/hour): {money(quote.extensionCharge ?? 0)}</p><p>Extra guests ({quote.extraGuests ?? 0}): {money(quote.additionalGuestCharge ?? 0)}</p><p className="font-semibold text-primary">Room total: {money(quote.unitPrice)}</p></div>}
        <button type="button" aria-label={`Remove additional room ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))} className="mt-3 min-h-11 font-semibold text-primary underline">Remove room</button>
      </fieldset>;
    })}</div>
    <button type="button" disabled={state.loading || value.length >= 20 || !newRoom} onClick={() => { if (newRoom) onChange([...value, newRoom]); }} className="mt-4 min-h-12 rounded-full border border-primary px-5 py-3 font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-40">Add room</button>
    {!state.loading && !newRoom && value.length < 20 && <p className="mt-2 text-sm text-neutral/60">{assignedGuests >= guestCount ? "All booking guests are assigned. Reduce guests in an existing room to add another room." : "No more rooms are available for these dates and configured durations."}</p>}
  </section>;
}
