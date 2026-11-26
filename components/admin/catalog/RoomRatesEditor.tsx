"use client";
import { useEffect, useState } from "react";
import { useActionConfirmation } from "@/components/ui/use-action-confirmation";
import { AdminFormSkeleton } from "@/components/admin/AdminSkeletons";
import type { RoomClass } from "@/lib/rooms/types";

const fields = [["rate_3_hours", "3-hour accommodation (PHP)"], ["rate_8_hours", "8-hour swimming room (PHP)"], ["rate_12_hours", "12-hour accommodation (PHP)"], ["extension_hourly_rate", "Extension per hour (PHP)"], ["additional_guest_rate", "Additional guest per stay (PHP)"]] as const;
function RateForm({ classification: c, onSaved }: { classification: RoomClass; onSaved: (c: RoomClass) => void }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(fields.map(([k]) => [k, String(c[k] ?? "")])));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const { confirm, confirmation } = useActionConfirmation();
  const dirty = fields.some(([k]) => draft[k] !== String(c[k] ?? ""));
  useEffect(() => { if (!dirty) return; const prevent = (e: BeforeUnloadEvent) => e.preventDefault(); window.addEventListener("beforeunload", prevent); return () => window.removeEventListener("beforeunload", prevent); }, [dirty]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      if (!await confirm({ title: "Save room rates?", message: `Publish these rates for ${c.name}? Existing accommodation charges stay unchanged. Future extension approvals use the current hourly rate.`, confirmText: "Save rates" })) return;
      const response = await fetch("/api/admin/catalog/room-rates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ classificationId: c.classification_id, expectedVersion: c.pricing_version, rates: Object.fromEntries(fields.map(([k]) => [k, k === "rate_8_hours" && draft[k] === "" ? null : Number(draft[k])])) }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message);
      onSaved(result.classification); setDraft(Object.fromEntries(fields.map(([k]) => [k, String(result.classification[k] ?? "")]))); setNotice(result.message);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save room rates."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={save} className="rounded-xl border border-neutral/10 bg-base/30 p-4">{confirmation}<h3 className="font-semibold">{c.name}</h3><p className="mt-1 text-sm text-neutral/60">{c.included_capacity} pax included · {c.maximum_capacity} pax maximum</p><fieldset disabled={busy} className="mt-4 grid gap-4 sm:grid-cols-2">{fields.map(([k, label]) => <label key={k} className="text-sm font-medium">{label}<input required={k !== "rate_8_hours"} placeholder={k === "rate_8_hours" ? "Not configured" : undefined} type="number" min={k === "additional_guest_rate" ? 0 : 0.01} max={1000000} step="0.01" className="admin-field mt-1 w-full" value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} /></label>)}</fieldset>{error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}{notice && <p role="status" className="mt-3 text-sm text-green-800">{notice}</p>}<div className="mt-4 flex justify-end"><button type="submit" className="admin-button-primary" disabled={busy || !dirty}>{busy ? "Saving…" : `Save ${c.name} rates`}</button></div></form>;
}
export default function RoomRatesEditor() {
  const [classes, setClasses] = useState<RoomClass[] | null>(null), [error, setError] = useState(""), [reload, setReload] = useState(0);
  useEffect(() => { const controller = new AbortController(); fetch("/api/admin/catalog/room-rates", { cache: "no-store", signal: controller.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.message); setClasses(d.classifications); setError(""); }).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, [reload]);
  return <section className="space-y-4 p-4 sm:p-6"><div><h2 className="text-xl font-semibold">Room accommodation rates</h2><p className="mt-1 text-sm text-neutral/60">Set 3-hour and 12-hour stay prices, a separate 8-hour rate for swimming room add-ons, hourly extensions and additional guest charges per room classification. PWD/senior and promo discounts use the accommodation charge; only the larger discount applies.</p></div>{error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error} <button className="underline" onClick={() => setReload(n => n + 1)}>Reload rates</button></p>}{!classes && !error && <AdminFormSkeleton fields={5} label="Loading room rates…" />}{classes?.length === 0 && <p className="text-sm text-neutral/60">No room classifications configured.</p>}{classes?.map(c => <RateForm key={`${c.classification_id}:${reload}`} classification={c} onSaved={updated => setClasses(rows => rows?.map(row => row.classification_id === updated.classification_id ? updated : row) ?? [])} />)}</section>;
}
