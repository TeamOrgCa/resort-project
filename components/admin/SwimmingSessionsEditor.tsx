"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import BookingDateCalendar from "@/components/booking/BookingDateCalendar";
import { useActionConfirmation } from "@/components/ui/use-action-confirmation";
import { formatManilaDateTime, manilaDateKey } from "@/lib/booking/manila-date";
import { PACKAGE_TIME_KEYS, PACKAGE_TIME_NAMES, packageTimeSlot, type PackageTimes } from "@/lib/booking/package-times";
import { SWIMMING_MODES, SWIMMING_MODE_LABELS, SWIMMING_MODE_DESCRIPTIONS, parseSwimmingPolicy, swimmingAccessMode,
  type SwimmingAccessMode, type SwimmingPeriod, type SwimmingPolicy } from "@/lib/booking/swimming-sessions";
import type { PublicSwimmingType } from "@/lib/booking/public-swimming";

type Draft = { policy: SwimmingPolicy; publicTypes: PublicSwimmingType[]; schedule: { version: number; times: PackageTimes }; privateDays: number };
type Conflict = { reservationId: string; referenceNumber: string; startDatetime: string; endDatetime: string; status: string; reason: string };
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function ModeSelect({ value, onChange, inherit, label }: { value: string; onChange: (v: string) => void; inherit?: boolean; label: string }) {
  return <select aria-label={label} className="admin-field mt-2 w-full" value={value} onChange={e => onChange(e.target.value)}>
    {inherit && <option value="">Use default</option>}{SWIMMING_MODES.map(m => <option value={m} key={m}>{SWIMMING_MODE_LABELS[m]}</option>)}
  </select>;
}
export default function SwimmingSessionsEditor() {
  const [draft, setDraft] = useState<Draft | null>(null), [expectedVersion, setExpectedVersion] = useState(0);
  const [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<Conflict[]>([]), [reload, setReload] = useState(0);
  const [date, setDate] = useState(() => manilaDateKey(new Date())), [to, setTo] = useState(date);
  const [period, setPeriod] = useState<SwimmingPeriod>("day"), [mode, setMode] = useState<SwimmingAccessMode>("public_only");
  const { confirm, confirmation } = useActionConfirmation();
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/swimming-sessions", { cache: "no-store", signal: controller.signal }).then(async r => {
      const data = await r.json(); if (!r.ok) throw new Error(data.message);
      if (!controller.signal.aborted) { setDraft(data); setExpectedVersion(data.policy.version); setError(""); }
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [reload]);
  const updatePolicy = (patch: Partial<SwimmingPolicy>) => setDraft(d => d ? { ...d, policy: { ...d.policy, ...patch } } : d);
  async function save() {
    if (!draft || busy) return;
    setError(""); setMessage(""); setConflicts([]);
    if (!parseSwimmingPolicy(draft.policy)) { setError("Review booking windows and date overrides. Ranges for the same session must not overlap."); return; }
    if (!await confirm({ title: "Apply swimming schedule changes?", message: "Review the weekly schedule, overrides, operating hours, capacity and booking policies. Changes apply immediately. Existing reservations and active payment holds must remain valid.", confirmText: "Apply swimming configuration" })) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/swimming-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        policy: draft.policy, expectedVersion, publicTypes: draft.publicTypes, times: draft.schedule.times, packageVersion: draft.schedule.version, privateDays: draft.privateDays,
      }) }), data = await r.json();
      if (!r.ok) { setConflicts(data.conflicts ?? []); throw new Error(data.message); }
      setExpectedVersion(data.policy.version); setMessage("Swimming configuration saved and recorded in the audit log."); setReload(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save swimming configuration."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-5">
    <div><h2 className="text-xl font-semibold">Swimming session management</h2><p className="mt-2 text-sm text-neutral/70">All sessions share one pool. Dates, cutoffs and recurring schedules use Asia/Manila. The Flexible window counts calendar days including today. Public-only and private advance limits include the last permitted date.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{message}</p>}
    {!!conflicts.length && <div className="overflow-x-auto rounded-xl border border-red-200"><table className="w-full text-left text-sm"><caption className="p-3 text-left font-semibold">Affected reservations — resolve these allocations before changing the schedule</caption><thead><tr>{["Reservation", "Session (Manila)", "Status", "Conflict"].map(h => <th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{conflicts.map(c => <tr key={c.reservationId}><td className="p-3"><Link href="/admin/reservations" className="underline">{c.referenceNumber}</Link></td><td className="p-3">{formatManilaDateTime(c.startDatetime)} – {formatManilaDateTime(c.endDatetime)}</td><td className="p-3">{c.status}</td><td className="p-3">{c.reason}</td></tr>)}</tbody></table></div>}
    {!draft ? <button type="button" className="admin-button-secondary" onClick={() => setReload(n => n + 1)}>Reload swimming configuration</button> : <>
      <fieldset disabled={busy} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">{SWIMMING_MODES.map(m => <div key={m} className="rounded-xl border border-neutral/15 p-4"><h3 className="font-semibold">{SWIMMING_MODE_LABELS[m]}</h3><p className="mt-2 text-sm text-neutral/70">{SWIMMING_MODE_DESCRIPTIONS[m]}</p></div>)}</div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-2 text-sm"><span>Default access mode</span><ModeSelect label="Default access mode" value={draft.policy.defaultMode} onChange={v => updatePolicy({ defaultMode: v as SwimmingAccessMode })} /></label>
          {([
            ["flexibleDays", "Flexible public window (days)", 1, 366], ["publicOnlyDays", "Public-only advance window (days)", 1, 366],
            ["minimumAdvanceMinutes", "Minimum advance booking time (minutes)", 30, 10080], ["bufferMinutes", "Cleaning and preparation buffer (minutes)", 0, 1440],
          ] as const).map(([key, label, min, max]) => <label key={key} className="space-y-2 text-sm"><span>{label}</span><input type="number" className="admin-field mt-2 w-full" min={min} max={max} value={draft.policy[key]} onChange={e => updatePolicy({ [key]: Number(e.target.value) })} /></label>)}
          <label className="space-y-2 text-sm"><span>Private advance window (days)</span><input type="number" className="admin-field mt-2 w-full" min={0} max={3650} value={draft.privateDays} onChange={e => setDraft({ ...draft, privateDays: Number(e.target.value) })} /><span className="block text-neutral/60">Uses the existing maximum advance booking setting, also used by room bookings.</span></label>
        </div>
        <div className="flex flex-wrap gap-5"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.policy.sameDay} onChange={e => updatePolicy({ sameDay: e.target.checked })} />Allow same-day swimming bookings</label>{(["day", "night"] as const).map(p => <label key={p} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.policy.active[p]} onChange={e => updatePolicy({ active: { ...draft.policy.active, [p]: e.target.checked } })} />{p === "day" ? "Day" : "Night / overnight"} session active</label>)}</div>
        <section><h3 className="mb-3 font-semibold">Operating hours and public capacity</h3>
          <p className="mb-3 text-sm text-neutral/70">These fields edit the existing Business Catalog session records and versioned private package hours. Saved bookings retain their timestamps and pricing.</p>
          <div className="grid gap-4 lg:grid-cols-2">{draft.publicTypes.map((t, i) => {
            const update = (patch: Partial<PublicSwimmingType>) => setDraft({ ...draft, publicTypes: draft.publicTypes.map((v, n) => n === i ? { ...v, ...patch } : v) });
            return <div key={t.type_id} className="space-y-3 rounded-xl border border-neutral/15 p-4"><h4 className="font-semibold">{t.name}</h4><div className="grid grid-cols-2 gap-3"><label className="text-sm">Start<input aria-label={`${t.name} start`} type="time" className="admin-field mt-2 w-full" value={t.start_time.slice(0, 5)} onChange={e => update({ start_time: e.target.value })} /></label><label className="text-sm">End<input aria-label={`${t.name} end`} type="time" className="admin-field mt-2 w-full" value={t.end_time.slice(0, 5)} onChange={e => update({ end_time: e.target.value })} /></label></div>
              <label className="flex gap-2 text-sm"><input type="checkbox" checked={t.end_day_offset === 1} onChange={e => update({ end_day_offset: e.target.checked ? 1 : 0 })} />Ends the following day</label>
              <label className="block text-sm">Maximum public guests per session<input type="number" className="admin-field mt-2 w-full" min={1} max={10000} placeholder="No configured limit" value={t.max_guests ?? ""} onChange={e => update({ max_guests: e.target.value ? Number(e.target.value) : null })} /></label>
              <label className="flex gap-2 text-sm"><input type="checkbox" checked={t.is_active} onChange={e => update({ is_active: e.target.checked })} />Public admissions active</label>
            </div>;
          })}{PACKAGE_TIME_KEYS.map(key => {
            const slot = packageTimeSlot(draft.schedule.times, key);
            const update = (patch: Partial<typeof slot>) => { const times = structuredClone(draft.schedule.times); Object.assign(packageTimeSlot(times, key), patch); setDraft({ ...draft, schedule: { ...draft.schedule, times } }); };
            return <div key={key} className="space-y-3 rounded-xl border border-neutral/15 p-4"><h4 className="font-semibold">Private {PACKAGE_TIME_NAMES[key]}</h4><div className="grid grid-cols-2 gap-3"><label className="text-sm">Start<input aria-label={`${key} private start`} type="time" className="admin-field mt-2 w-full" value={slot.start} onChange={e => update({ start: e.target.value })} /></label><label className="text-sm">End<input aria-label={`${key} private end`} type="time" className="admin-field mt-2 w-full" value={slot.end} onChange={e => update({ end: e.target.value })} /></label></div><label className="flex gap-2 text-sm"><input type="checkbox" checked={slot.endDayOffset === 1} onChange={e => update({ endDayOffset: e.target.checked ? 1 : 0 })} />Ends the following day</label></div>;
          })}</div>
        </section>
        <section><h3 className="mb-3 font-semibold">Weekly swimming schedule</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Weekday</th><th className="p-2">Day Swimming</th><th className="p-2">Night / Overnight Swimming</th></tr></thead><tbody>{weekdays.map((day, i) => <tr key={day}><th className="p-2 font-medium">{day}</th>{(["day", "night"] as const).map(p => <td className="p-2" key={p}><ModeSelect label={`${day} ${p} access mode`} inherit value={draft.policy.weekly[String(i)]?.[p] ?? ""} onChange={v => {
          const weekly = structuredClone(draft.policy.weekly); weekly[i] ??= {}; if (v) weekly[i][p] = v as SwimmingAccessMode; else delete weekly[i][p]; updatePolicy({ weekly });
        }} /></td>)}</tr>)}</tbody></table></div></section>
        <section className="space-y-4"><h3 className="font-semibold">Specific date overrides</h3><p className="text-sm text-neutral/70">Overrides take precedence over the weekly schedule. Choose a calendar date, then optionally extend through an inclusive end date. Each period can have one override per date.</p>
          <BookingDateCalendar value={date} onChange={d => { setDate(d); setTo(d); }} title="Override calendar" allowUnavailableSelection getDateHint={d => `${SWIMMING_MODE_LABELS[swimmingAccessMode(draft.policy, d, "day")]} / ${SWIMMING_MODE_LABELS[swimmingAccessMode(draft.policy, d, "night")]}`} />
          <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-5"><label className="text-sm">From<input type="date" className="admin-field mt-2 w-full" value={date} onChange={e => { setDate(e.target.value); setTo(e.target.value); }} /></label><label className="text-sm">Through<input type="date" className="admin-field mt-2 w-full" min={date} value={to} onChange={e => setTo(e.target.value)} /></label><label className="text-sm">Session<select className="admin-field mt-2 w-full" value={period} onChange={e => setPeriod(e.target.value as SwimmingPeriod)}><option value="day">Day</option><option value="night">Night / Overnight</option></select></label><ModeSelect label="Override access mode" value={mode} onChange={v => setMode(v as SwimmingAccessMode)} /><button type="button" className="admin-button-secondary" onClick={() => {
            const policy = { ...draft.policy, overrides: [...draft.policy.overrides, { from: date, to, period, mode }] };
            if (!parseSwimmingPolicy(policy)) { setError("Choose valid dates without overlapping another override for this session."); return; } updatePolicy({ overrides: policy.overrides }); setError("");
          }}>Add override</button></div>
          <ul className="space-y-2">{draft.policy.overrides.map((o, i) => <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-base p-3 text-sm" key={`${o.from}-${o.period}`}>{o.from} – {o.to} · {o.period === "day" ? "Day" : "Night / Overnight"} · {SWIMMING_MODE_LABELS[o.mode]}<button type="button" className="admin-button-secondary" aria-label={`Remove ${o.from} ${o.period} override`} onClick={() => updatePolicy({ overrides: draft.policy.overrides.filter((_, n) => i !== n) })}>Remove</button></li>)}</ul>
        </section>
      </fieldset>
      <div className="flex gap-3"><button type="button" className="admin-button-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save swimming configuration"}</button><button type="button" className="admin-button-secondary" disabled={busy} onClick={() => setReload(n => n + 1)}>Reload saved settings</button></div>
    </>}{confirmation}
  </section>;
}
