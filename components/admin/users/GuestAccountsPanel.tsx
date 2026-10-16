"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import CatalogDialog from "@/components/admin/catalog/CatalogDialog";

type GuestAccount = {
  id: string; first_name: string; middle_name: string | null; last_name: string;
  email: string; phone_number: string; is_active: boolean; created_at: string; email_confirmed: boolean;
};
const name = (guest: GuestAccount) => [guest.first_name, guest.middle_name, guest.last_name].filter(Boolean).join(" ");

export default function GuestAccountsPanel() {
  const [rows, setRows] = useState<GuestAccount[]>([]), [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState(""), [search, setSearch] = useState("");
  const [status, setStatus] = useState("all"), [page, setPage] = useState(0), [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<GuestAccount | null>(null), [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(""), [message, setMessage] = useState("");
  const savingRef = useRef(false);
  const close = useCallback(() => { if (!savingRef.current) setSelected(null); }, []);

  useEffect(() => {
    if (searchInput.trim() === search) return;
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setPage(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setError("");
      try {
        const query = new URLSearchParams({ search, status, page: String(page) });
        const response = await fetch(`/api/admin/users/guests?${query}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.message ?? "Unable to load guest accounts.");
        if (!controller.signal.aborted) { setRows(data.rows ?? []); setTotal(Number(data.total ?? 0)); }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load guest accounts.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [search, status, page, reload]);

  async function changeStatus(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || savingRef.current) return;
    savingRef.current = true;
    setSaving(true); setSaveError("");
    try {
      const response = await fetch(`/api/admin/users/guests/${selected.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !selected.is_active, expectedActive: selected.is_active, reason: reason.trim() }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message ?? "Unable to update guest access.");
      setMessage(data.message); setSelected(null);
      if (rows.length === 1 && page > 0 && status !== "all") setPage(current => current - 1);
      setReload(current => current + 1);
    } catch (cause) { setSaveError(cause instanceof Error ? cause.message : "Unable to update guest access."); }
    finally { savingRef.current = false; setSaving(false); }
  }

  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold text-neutral">Guest Accounts</h2>
      <p className="mt-1 text-sm text-neutral/65">Manage registered guest access. Staff accounts and walk-in profiles are managed separately.</p></div>
    {message && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">{message}</p>}
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-medium text-neutral/65">Search guests</span>
        <input type="search" maxLength={200} value={searchInput} onChange={event => setSearchInput(event.target.value)} placeholder="Name, email or phone" className="min-h-11 w-full min-w-0 rounded-xl border border-neutral/20 bg-white px-3 text-[16px] text-black placeholder:text-neutral/45 sm:text-sm" /></label>
      <label><span className="mb-1 block text-xs font-medium text-neutral/65">Account status</span>
        <select value={status} onChange={event => { setStatus(event.target.value); setPage(0); }} className="min-h-11 w-full rounded-xl border border-neutral/20 bg-white px-3 text-[16px] text-black sm:text-sm">
          <option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select></label>
      <button type="button" disabled={loading} onClick={() => setReload(current => current + 1)} className="min-h-11 rounded-xl border border-neutral/20 px-4 text-sm font-semibold disabled:opacity-50">Refresh guests</button>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {loading ? <p role="status" className="py-6 text-sm text-neutral/60">Loading guest accounts...</p>
      : !error && !rows.length ? <p className="rounded-xl bg-base p-8 text-center text-sm text-neutral/65">No guest accounts match these filters.</p>
      : !error && <div className="space-y-3">{rows.map(guest => <article key={guest.id} aria-label={`Guest account ${guest.email}`} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-neutral/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold text-neutral">{name(guest)}</h3><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${guest.is_active ? "bg-emerald-50 text-emerald-800" : "bg-neutral/10 text-neutral/65"}`}>{guest.is_active ? "Active" : "Inactive"}</span></div>
          <p className="mt-1 break-all text-sm text-neutral/70">{guest.email}</p><p className="mt-1 text-xs text-neutral/60">{guest.phone_number}</p>
          <p className="mt-2 text-xs text-neutral/55">{guest.email_confirmed ? "Email confirmed" : "Email not confirmed"} &middot; Registered {new Date(guest.created_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" })}</p>
        </div>
        <button type="button" onClick={() => { setSelected(guest); setReason(""); setSaveError(""); setMessage(""); }} className={`min-h-11 shrink-0 rounded-xl border px-4 text-sm font-semibold ${guest.is_active ? "border-red-200 text-red-700 hover:bg-red-50" : "border-emerald-200 text-emerald-800 hover:bg-emerald-50"}`}>{guest.is_active ? "Deactivate" : "Reactivate"}</button>
      </article>)}</div>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral/10 pt-4 text-sm">
      <p className="text-neutral/60">{total} guest accounts &middot; Page {page + 1} of {Math.max(1, Math.ceil(total / 10))}</p>
      <div className="flex gap-2"><button type="button" disabled={loading || page === 0} onClick={() => setPage(current => current - 1)} className="min-h-11 rounded-lg border border-neutral/15 px-3 disabled:opacity-40">Previous</button>
        <button type="button" disabled={loading || (page + 1) * 10 >= total} onClick={() => setPage(current => current + 1)} className="min-h-11 rounded-lg border border-neutral/15 px-3 disabled:opacity-40">Next</button></div>
    </div>
    {selected && <CatalogDialog title={selected.is_active ? "Deactivate guest account" : "Reactivate guest account"} description={`${name(selected)} (${selected.email})`} busy={saving} onClose={close}>
      <form onSubmit={changeStatus} className="space-y-4">
        <p className="text-sm leading-relaxed text-neutral/75">{selected.is_active ? "The guest will be blocked from signing in and using their existing website session. Existing reservations, payments and refunds remain recorded for staff to manage." : "The guest will be able to sign in again. They must start a new session; their previous session will stay ended."}</p>
        {saveError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
        <label className="block text-sm font-medium text-black">Reason (optional)<textarea data-autofocus rows={3} maxLength={1000} disabled={saving} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-xl border border-neutral/20 bg-white p-3 text-[16px] text-black" /></label>
        <p className="text-xs text-neutral/55">The status change, administrator and reason are recorded in the audit log.</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={close} className="min-h-11 rounded-xl border border-neutral/20 px-4 text-sm font-semibold disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="min-h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : selected.is_active ? "Confirm deactivation" : "Confirm reactivation"}</button></div>
      </form>
    </CatalogDialog>}
  </div>;
}
