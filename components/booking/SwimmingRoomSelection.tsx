"use client";
import { useEffect, useState } from "react";
import { availableRoomCount, type CustomerRoomCatalog } from "@/lib/booking/customer-rooms";
import { swimmingRoomPrice, swimmingRoomsQuote, type SwimmingRoomSelection } from "@/lib/booking/swimming-rooms";

export function useSwimmingRooms(start: string, end: string, rooms: SwimmingRoomSelection[], privateSwimming: boolean) {
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
  if (catalog) { try { quote = swimmingRoomsQuote(catalog, rooms, start, end, privateSwimming); } catch (e) { issue = e instanceof Error ? e.message : "Review your room choices."; } }
  return { catalog, loading, error: issue, quote, refresh: () => setRetry(n => n + 1) };
}
export default function SwimmingRoomSelection({ state, value, onChange, start, end, privateSwimming = false }: {
  state: ReturnType<typeof useSwimmingRooms>; value: SwimmingRoomSelection[]; onChange: (rooms: SwimmingRoomSelection[]) => void;
  start: string; end: string; privateSwimming?: boolean;
}) {
  const money = (n: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n);
  return <section data-booking-guide="guest-rooms" className="mb-8">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="text-xl font-semibold text-neutral">{privateSwimming ? "Included Rooms & Extra Rooms" : "Optional Rooms"}</h3><button type="button" disabled={state.loading} onClick={state.refresh} className="text-sm font-semibold text-primary underline">Refresh rooms</button></div>
    <p className="mb-4 text-sm text-neutral/70">{privateSwimming ? "Two Standard rooms are included at no extra charge. Select only the additional rooms you need below." : "Public admission does not include a room. Add a room if you need one, or continue without rooms."} Rooms cover your swimming session. Up to 3 hours uses the 3-hour rate; longer sessions use the 12-hour rate plus hourly extensions beyond 12 hours.</p>
    {state.loading && <p role="status" className="text-sm text-neutral/70">Checking room availability...</p>}
    {state.error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}
    <div className="grid gap-3 sm:grid-cols-2">{state.catalog?.classifications.map(c => {
      let price: number;
      try { price = swimmingRoomPrice(c, start, end); } catch { return <p key={c.classification_id} className="text-sm text-red-700">{c.name} rates are unavailable. Please refresh.</p>; }
      const included = privateSwimming && c.code === "standard" ? 2 : 0;
      const available = availableRoomCount(state.catalog!, c.classification_id, start, end);
      const quantity = value.find(r => r.classificationId === c.classification_id)?.quantity ?? 0;
      return <label key={c.classification_id} className="block rounded-xl border border-neutral/20 p-4 text-sm text-neutral">
        <span className="block font-semibold">{c.name}</span>
        {included > 0 && <span className="mt-1 block font-semibold text-primary">2 rooms included · ₱0 additional charge</span>}
        <span className="mt-2 block">{money(price)} per extra room for this session</span>
        <span className="mt-1 block text-neutral/70">{available} extra rooms available · {c.included_capacity} guests included per room</span>
        <span className="mt-3 block font-medium">Extra rooms</span>
        <select aria-label={`Extra ${c.name}`} disabled={state.loading || available === 0 && quantity === 0} value={quantity} className="mt-2 w-full rounded-lg border border-neutral/20 bg-white px-4 py-3" onChange={e => {
          const next = value.filter(r => r.classificationId !== c.classification_id), quantity = Number(e.target.value);
          if (quantity) next.push({ classificationId: c.classification_id, quantity, pricingVersion: Number(c.pricing_version), name: c.name, unitPrice: price });
          onChange(next);
        }}>{Array.from({ length: Math.min(20, Math.max(available, quantity)) + 1 }, (_, n) => <option key={n} value={n} disabled={n > available}>{n === 0 ? "No extra rooms" : n}</option>)}</select>
      </label>;
    })}</div>
    {!state.loading && !state.error && !state.catalog?.classifications.length && <p className="text-sm text-neutral/60">No rooms are currently available for this session.</p>}
  </section>;
}
