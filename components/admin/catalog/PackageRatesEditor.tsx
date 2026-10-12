"use client";
import { useEffect, useState } from "react";
import { RATE_TIERS, PACKAGE_MODES, PACKAGE_LABELS, parsePackageRates, parsePackageRateSchedule, type PackageRates, type PackageRateSchedule, type RateTier, type PackageMode } from "@/lib/booking/package-rates";
import { INCLUDED_GUESTS } from "@/lib/booking/guest-count";

type Draft = Record<RateTier, Record<PackageMode, { baseRate: string; addOnPerHead: string }>>;
const toDraft = (s: PackageRateSchedule) => Object.fromEntries(RATE_TIERS.map(t => [t, Object.fromEntries(PACKAGE_MODES.map(m => [m,
  { baseRate: String(s.rates[t][m].baseRate), addOnPerHead: String(s.rates[t][m].addOnPerHead) }]))])) as Draft;

export default function PackageRatesEditor() {
  const [schedule, setSchedule] = useState<PackageRateSchedule | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [defaultRates, setDefaultRates] = useState<PackageRates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/catalog/package-rates", { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); const parsed = parsePackageRateSchedule(result.schedule);
      const defaults = parsePackageRates(result.defaultRates);
      if (!response.ok || !parsed || !defaults) throw new Error(result.message ?? "Unable to load package rates.");
      if (!controller.signal.aborted) { setSchedule(parsed); setDraft(toDraft(parsed)); setDefaultRates(defaults); setError(null); setMessage(null); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [reload]);

  function restoreDefaults() {
    if (!schedule || !defaultRates || busy) return;
    setDraft(toDraft({ version: schedule.version, rates: defaultRates }));
    setError(null);
    setMessage("Default rates loaded. Select Save package rates to apply them to new bookings.");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || !schedule || busy) return;
    const rates = parsePackageRates(Object.fromEntries(RATE_TIERS.map(t => [t, Object.fromEntries(PACKAGE_MODES.map(m => [m,
      { baseRate: Number(draft[t][m].baseRate), addOnPerHead: Number(draft[t][m].addOnPerHead) }]))])));
    if (!rates) { setError("Enter positive package prices and non-negative extra-person charges, using up to two decimal places."); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/admin/catalog/package-rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rates, expectedVersion: schedule.version }) });
      const result = await response.json(); const parsed = parsePackageRateSchedule(result.schedule);
      if (!response.ok || !parsed) throw new Error(result.message ?? "Unable to save package rates.");
      setSchedule(parsed); setDraft(toDraft(parsed)); setMessage(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save package rates."); }
    finally { setBusy(false); }
  }

  return <form onSubmit={save} className="p-4 sm:p-6">
    <h2 className="text-xl font-semibold text-neutral">Swimming package rates</h2>
    <p className="mt-1 text-sm text-neutral/60">Set weekday and weekend prices for packages covering {INCLUDED_GUESTS} guests. Booking times are fixed.</p>
    {error && <div role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700"><p>{error}</p><button type="button" disabled={busy} onClick={() => { setSchedule(null); setDraft(null); setReload(n => n + 1); }} className="mt-2 underline">Reload rates</button></div>}
    {message && <p role="status" className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    {!draft && !error && <p role="status" className="py-8 text-sm text-neutral/60">Loading package rates…</p>}
    {draft && <>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        {RATE_TIERS.map(tier => <fieldset key={tier} disabled={busy} className="rounded-xl border border-neutral/10 bg-base/40 p-4">
          <legend className="px-2 font-semibold text-neutral">{tier === "weekday" ? "Weekday · Monday–Thursday" : "Weekend · Friday–Sunday"}</legend>
          <div className="space-y-5">{PACKAGE_MODES.map(mode => <div key={mode}>
            <h3 className="text-sm font-semibold text-neutral">{PACKAGE_LABELS[mode].name}</h3><p className="mt-1 text-xs text-neutral/60">{PACKAGE_LABELS[mode].times}</p>
            <div className="mt-3 grid grid-cols-2 gap-3">{(["baseRate", "addOnPerHead"] as const).map(field => <label key={field} className="text-xs text-neutral/70">{field === "baseRate" ? `Package price (${INCLUDED_GUESTS} pax)` : "Additional guest / head"}
              <div className="mt-1 flex items-center rounded-lg border border-neutral/20 bg-white focus-within:ring-2 focus-within:ring-primary"><span className="pl-3 text-sm text-neutral/50">₱</span><input aria-label={`${tier} ${PACKAGE_LABELS[mode].name} ${field === "baseRate" ? "package price" : "additional guest price"}`} required type="number" step="0.01" min={field === "baseRate" ? "0.01" : "0"} max="999999" className="min-w-0 w-full rounded-lg bg-transparent px-2 py-2.5 text-sm outline-none disabled:opacity-60" value={draft[tier][mode][field]} onChange={e => setDraft({ ...draft, [tier]: { ...draft[tier], [mode]: { ...draft[tier][mode], [field]: e.target.value } } })} /></div>
            </label>)}</div>
          </div>)}</div>
        </fieldset>)}
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-neutral/10 pt-5">
        <p className="max-w-xl text-sm text-neutral/60">Saved prices apply to new bookings. Existing reservations keep their booked rates and billing history.</p>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy || !schedule || !defaultRates} type="button" onClick={restoreDefaults} className="rounded-xl border border-neutral/20 px-5 py-2.5 text-sm font-semibold text-neutral hover:bg-base disabled:opacity-50">Restore defaults</button>
          <button disabled={busy || !schedule} type="submit" className="rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save package rates"}</button>
        </div>
      </div>
    </>}
  </form>;
}
