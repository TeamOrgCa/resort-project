"use client";

import { useEffect, useRef, useState } from "react";
import { useActionConfirmation } from "@/components/ui/use-action-confirmation";
import { documentDateLabel, legalContentSections, type LegalDocumentType, type LegalPolicies, type PublishedLegalDocument } from "@/lib/legal/documents";
import LegalDocument from "@/components/legal/LegalDocument";

const field = "mt-2 w-full rounded-xl border border-neutral/20 bg-white px-3 py-3 text-sm text-neutral focus:outline-primary disabled:bg-base";
type Draft = { title: string; content: string; changeNote: string };

export default function LegalPoliciesEditor() {
  const [policies, setPolicies] = useState<LegalPolicies | null>(null), [history, setHistory] = useState<PublishedLegalDocument[]>([]);
  const [documentType, setDocumentType] = useState<LegalDocumentType>("terms");
  const [draft, setDraft] = useState<Draft>({ title: "", content: "", changeNote: "" });
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const sending = useRef(false);
  const { confirm, confirmation } = useActionConfirmation();
  const current = policies?.[documentType];
  const changed = Boolean(current && (draft.title.trim() !== current.title || draft.content.trim() !== current.content));

  async function load(type: LegalDocumentType, signal?: AbortSignal) {
    const response = await fetch("/api/admin/legal-policies", { cache: "no-store", signal }), result = await response.json();
    if (!response.ok || !result.policies) throw new Error(result.message ?? "Unable to load legal policies.");
    if (signal?.aborted) return;
    setPolicies(result.policies); setHistory(result.history ?? []); setDraft({ title: result.policies[type].title, content: result.policies[type].content, changeNote: "" });
    setStale(false); setError(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    void load("terms", controller.signal).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to load policies."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function changeDocument(type: LegalDocumentType) {
    if (type === documentType || !policies) return;
    if (changed && !await confirm({ title: "Discard unpublished policy edits?", message: "Your edits have not been published. Switching documents will discard this draft.", confirmText: "Discard edits" })) return;
    setDocumentType(type); setDraft({ title: policies[type].title, content: policies[type].content, changeNote: "" }); setMessage(null); setError(null); setStale(false);
  }
  async function publish(event: React.FormEvent) {
    event.preventDefault();
    if (!current || !changed || stale || sending.current) return;
    sending.current = true; setSaving(true); setError(null); setMessage(null);
    try {
      if (!await confirm({ title: `Publish ${documentType === "terms" ? "Terms and Conditions" : "Privacy Policy"} version ${current.version + 1}?`,
        message: "The new text will appear on the website and apply to new registrations and bookings. Previous versions and existing booking acceptances will be retained.", confirmText: "Publish new version" })) return;
      const response = await fetch("/api/admin/legal-policies", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType, ...draft, expectedVersion: current.version }) }), result = await response.json();
      if (!response.ok || !result.success) { if (response.status === 409) setStale(true); throw new Error(result.message ?? "Unable to publish policy."); }
      setMessage(`Version ${result.policy.version} published. Previous versions remain available below.`);
      try { await load(documentType); } catch { setStale(true); setError("The version was published, but its history could not be refreshed. Reload current policies before making another change."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to publish policy."); }
    finally { sending.current = false; setSaving(false); }
  }

  return <div className="min-w-0 space-y-5 p-4 sm:p-6">
    <div><h2 className="text-xl font-semibold text-neutral">Terms and Privacy Policy</h2><p className="mt-2 text-sm leading-relaxed text-neutral/65">Edit the documents shown on the website, registration and booking agreements. Publishing creates a new version; it preserves earlier text and accepted versions. Cancellation and refund rules are managed in Configuration → Reservation settings.</p></div>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Legal documents">{(["terms", "privacy"] as const).map(type => <button key={type} type="button" disabled={loading || saving} aria-pressed={documentType === type} onClick={() => void changeDocument(type)} className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold disabled:opacity-50 ${documentType === type ? "border-primary bg-primary/10 text-primary" : "border-neutral/20"}`}>{type === "terms" ? "Terms and Conditions" : "Privacy Policy"}</button>)}</div>
    {loading && <p role="status">Loading policy versions...</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-800">{message}</p>}
    {!loading && (error || stale) && <button type="button" disabled={saving} onClick={() => { setLoading(true); void load(documentType).catch(cause => setError(cause instanceof Error ? cause.message : "Unable to reload policies.")).finally(() => setLoading(false)); }} className="min-h-11 rounded-xl border px-4 py-2 text-sm font-semibold">Reload current policies</button>}
    {current && <form onSubmit={publish} className="space-y-5">
      <p className="text-sm text-neutral/60">Current version {current.version} · Published {documentDateLabel(current.published_at)}</p>
      <fieldset disabled={saving || loading || stale} className="min-w-0 space-y-4">
        <label className="block text-sm font-semibold">Document title<input name="title" required minLength={3} maxLength={200} className={field} value={draft.title} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} /></label>
        <label className="block text-sm font-semibold">Policy text<textarea name="content" rows={14} required minLength={20} maxLength={50000} className={field} value={draft.content} onChange={event => setDraft(value => ({ ...value, content: event.target.value }))} /><span className="mt-1 block text-xs font-normal text-neutral/60">Use # for headings, blank lines between paragraphs and - for list items. Text is displayed safely without HTML.</span></label>
        <label className="block text-sm font-semibold">Reason for revision<textarea name="changeNote" rows={2} required maxLength={1000} className={field} value={draft.changeNote} onChange={event => setDraft(value => ({ ...value, changeNote: event.target.value }))} /></label>
        <details className="rounded-xl border border-neutral/15 p-4"><summary className="min-h-9 cursor-pointer font-semibold">Preview document</summary><div className="mt-4"><LegalDocument sections={legalContentSections(draft.content)} /></div></details>
        <button type="submit" disabled={!changed || draft.title.trim().length < 3 || draft.content.trim().length < 20 || !draft.changeNote.trim()} className="min-h-11 rounded-xl bg-primary px-5 py-3 font-semibold text-white disabled:opacity-50">{saving ? "Publishing..." : "Publish new version"}</button>
      </fieldset>
    </form>}
    <section className="space-y-3 border-t border-neutral/10 pt-5"><h3 className="font-semibold">Version history</h3>
      {history.filter(item => item.document_type === documentType).map(item => <details key={item.policy_id} className="rounded-xl border border-neutral/15 bg-white p-4">
        <summary className="min-h-9 cursor-pointer text-sm font-semibold">Version {item.version}{item.is_active ? " (current)" : ""} · {documentDateLabel(item.published_at)}</summary>
        <p className="my-3 text-sm text-neutral/65">{item.change_note}</p><h4 className="mb-4 font-semibold">{item.title}</h4><LegalDocument sections={legalContentSections(item.content)} />
      </details>)}
    </section>
    {confirmation}
  </div>;
}
