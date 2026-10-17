"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";
import AdminTabs from "@/components/admin/AdminTabs";
import CatalogDialog from "./CatalogDialog";
import CatalogEditorDialog from "./CatalogEditorDialog";
import PackageRatesEditor from "./PackageRatesEditor";
import { catalogResources, catalogResourceKeys, catalogRecordName, isCatalogActive, type CatalogDefinition, type CatalogRecord, type CatalogReferences, type CatalogResource, type CatalogStatus } from "@/lib/catalog/catalog";
import { validateCatalogRecord } from "@/lib/catalog/validation";
import { isContentImageUrl } from "@/lib/settings/public-content";
import { formatManilaDate, formatManilaTime } from "@/lib/booking/manila-date";

const visibleCatalogResources = catalogResourceKeys.filter(key => key !== "unit_rates" && key !== "guest_rates");

const PAGE_SIZE = 15;
const emptyReferences: CatalogReferences = { units: [], paymentMethods: [] };
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
interface Filters { resource: CatalogResource; status: CatalogStatus; search: string; unitId: string; page: number }
interface Editor { resource: CatalogResource; record: CatalogRecord | null }
interface Action { kind: "archive" | "restore"; resource: CatalogResource; record: CatalogRecord }
interface ListResponse { records: CatalogRecord[]; total: number; counts: { active: number; archived: number } }

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new Error(result?.message ?? "Unable to complete the request. Please try again.");
  return result as T;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Please check your connection and try again.";

export default function CatalogClient() {
  const [showPackageRates, setShowPackageRates] = useState(false);
  const [filters, setFilters] = useState<Filters>({ resource: "services", status: "active", search: "", unitId: "", page: 1 });
  const [searchDraft, setSearchDraft] = useState("");
  const [records, setRecords] = useState<CatalogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({ active: 0, archived: 0 });
  const [references, setReferences] = useState<CatalogReferences>(emptyReferences);
  const [referencesError, setReferencesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mutationInProgress = useRef(false);
  const [notice, setNotice] = useState<{ text: string; warning?: boolean } | null>(null);
  const definition: CatalogDefinition = catalogResources[filters.resource];
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    const timer = window.setTimeout(() => setFilters((current) => current.search === searchDraft.trim() ? current : { ...current, search: searchDraft.trim(), page: 1 }), 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (controller.signal.aborted) return;
      setLoading(true); setLoadError(null);
      try {
        const params = new URLSearchParams({ resource: filters.resource, status: filters.status, page: String(filters.page), pageSize: String(PAGE_SIZE) });
        if (filters.search) params.set("search", filters.search);
        if (filters.unitId) params.set("unitId", filters.unitId);
        const result = await requestJson<ListResponse>(`/api/admin/catalog?${params}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        const nextLastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (filters.page > nextLastPage) { setFilters((current) => ({ ...current, page: nextLastPage })); return; }
        setRecords(result.records); setTotal(result.total); setCounts(result.counts);
      } catch (error) {
        if (!controller.signal.aborted) { setRecords([]); setLoadError(errorMessage(error)); }
      } finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void Promise.resolve().then(load);
    return () => controller.abort();
  }, [filters, refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const result = await requestJson<{ references: CatalogReferences }>("/api/admin/catalog?resource=references", { signal: controller.signal });
        if (!controller.signal.aborted) { setReferences(result.references); setReferencesError(null); }
      } catch (error) { if (!controller.signal.aborted) setReferencesError(errorMessage(error)); }
    };
    void load();
    return () => controller.abort();
  }, [refreshVersion]);

  const closeEditor = useCallback(() => { if (!mutationInProgress.current) { setEditor(null); setEditorError(null); } }, []);
  const closeAction = useCallback(() => { if (!mutationInProgress.current) { setAction(null); setActionError(null); } }, []);
  const refresh = () => { setLoading(true); setRefreshVersion((value) => value + 1); };
  const openEditor = (record: CatalogRecord | null) => { setEditor({ resource: filters.resource, record }); setEditorError(null); };

  const save = async (draft: CatalogRecord, qrFile: File | null) => {
    if (!editor || mutationInProgress.current) return;
    let normalized: CatalogRecord;
    try { normalized = validateCatalogRecord(editor.resource, draft); } catch (error) { setEditorError(errorMessage(error)); return; }
    if (editor.resource === "payment_accounts" && !editor.record?.qr_image && !qrFile) { setEditorError("Upload a payment QR image before saving."); return; }
    mutationInProgress.current = true; setBusy(true); setEditorError(null);
    const resource = editor.resource; const id = editor.record?.[catalogResources[resource].id];
    try {
      const payload = JSON.stringify({ resource, ...(id ? { id } : {}), record: normalized });
      const form = new FormData(); form.set("payload", payload);
      if (qrFile) form.set("file", qrFile);
      const result = await requestJson<{ record: CatalogRecord }>("/api/admin/catalog", {
        method: id ? "PATCH" : "POST",
        ...(resource === "payment_accounts" ? { body: form } : { headers: { "Content-Type": "application/json" }, body: payload }),
      });
      setEditor(null);
      setNotice({ text: `${catalogRecordName(resource, result.record, references)} ${id ? "updated" : "added"} successfully.` });
      refresh();
    } catch (error) { setEditorError(errorMessage(error)); }
    finally { mutationInProgress.current = false; setBusy(false); }
  };

  const confirmAction = async () => {
    if (!action || mutationInProgress.current) return;
    mutationInProgress.current = true; setBusy(true); setActionError(null);
    const id = String(action.record[catalogResources[action.resource].id]);
    try {
      if (action.kind === "archive") {
        await requestJson(`/api/admin/catalog?${new URLSearchParams({ resource: action.resource, id })}`, { method: "DELETE" });
      } else {
        await requestJson("/api/admin/catalog", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: action.resource, id, action: "restore" }) });
      }
      setNotice({ text: `${catalogRecordName(action.resource, action.record, references)} ${action.kind === "archive" ? "archived" : "restored"} successfully.` });
      setAction(null); refresh();
    } catch (error) { setActionError(errorMessage(error)); }
    finally { mutationInProgress.current = false; setBusy(false); }
  };

  const displayValue = (key: string, value: unknown): string => {
    if (key === "unit_id") {
      const unit = references.units.find((item) => item.unit_id === value);
      return unit ? `${unit.name}${isCatalogActive(unit) ? "" : " (archived)"}` : "Unavailable unit";
    }
    if (key === "payment_method_id") {
      const method = references.paymentMethods.find((item) => item.payment_method_id === value);
      return method ? `${method.name}${method.is_active ? "" : " (archived)"}` : "Unavailable method";
    }
    if (value === null || value === undefined || value === "") return key === "effective_to" ? "No end date" : "—";
    const field = definition.fields.find((field) => field.key === key);
    if (field?.kind === "money") return money.format(Number(value));
    if (field?.kind === "date") return formatManilaDate(String(value));
    if (field?.kind === "time") return formatManilaTime(`2000-01-01T${String(value).slice(0, 8)}+08:00`);
    return String(value);
  };
  const actionName = action ? catalogRecordName(action.resource, action.record, references) : "";
  const actionDescription = action?.kind === "archive"
    ? `Archive “${actionName}”? It will be removed from the active catalog. Existing records are kept, and you can restore it later.${action.resource === "payment_methods" ? " Its linked accounts will also be hidden from guests." : ""}`
    : `Restore “${actionName}” to the active catalog?${action?.resource === "guest_rates" ? " This replaces the currently active guest rate." : ""}`;

  return <div>
    <AdminSectionHeader title="Business Catalog" subtitle="Keep your resort offerings and operational details organized." />
    {notice && <div role="status" className={`mb-5 flex items-center justify-between gap-4 rounded-xl border px-4 py-3 text-sm ${notice.warning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-900"}`}><span>{notice.text}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)} className="font-medium underline">Dismiss</button></div>}
    <section className="overflow-hidden rounded-2xl border border-neutral/10 bg-white shadow-sm">
      <AdminTabs inset={false} tabs={["Package rates", ...visibleCatalogResources.map(resource => catalogResources[resource].label)]} value={showPackageRates ? "Package rates" : definition.label} label="Catalog categories" disabled={busy} onChange={label => {
        if (label === "Package rates") { setShowPackageRates(true); return; }
        const resource = visibleCatalogResources.find(key => catalogResources[key].label === label);
        if (!resource) return;
        setShowPackageRates(false); setLoading(true); setSearchDraft(""); setFilters({ resource, status: "active", search: "", unitId: "", page: 1 });
      }} />
      {showPackageRates ? <PackageRatesEditor /> : <div className="p-4 sm:p-6">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold text-neutral">{definition.label}</h2><p className="mt-1 text-sm text-neutral/60">{definition.description}</p></div>
          <button type="button" onClick={() => openEditor(null)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 disabled:opacity-50"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>Add {definition.singular}</button>
        </div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-base p-1" aria-label="Filter by status">
            {(["active", "archived", "all"] as const).map((status) => <button key={status} type="button" aria-pressed={filters.status === status} onClick={() => { setLoading(true); setFilters((current) => ({ ...current, status, page: 1 })); }} className={`whitespace-nowrap rounded-xl px-3 py-2 text-sm capitalize ${filters.status === status ? "bg-white font-semibold text-neutral shadow-sm" : "text-neutral/60 hover:text-neutral"}`}>{status} <span className="ml-1 text-xs text-neutral/45">{loading ? "…" : status === "all" ? counts.active + counts.archived : counts[status]}</span></button>)}
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {definition.search && <label className="relative grow sm:w-64"><span className="sr-only">Search {definition.label.toLowerCase()}</span><svg className="absolute left-3 top-3 text-neutral/45" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input type="search" value={searchDraft} maxLength={200} onChange={(event) => setSearchDraft(event.target.value)} placeholder={`Search ${definition.label.toLowerCase()}...`} className="w-full rounded-xl border border-neutral/20 py-2.5 pl-10 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>}
            {filters.resource === "unit_rates" && <label className="grow"><span className="sr-only">Filter by unit</span><select value={filters.unitId} onChange={(event) => { setLoading(true); setFilters((current) => ({ ...current, unitId: event.target.value, page: 1 })); }} className="w-full rounded-xl border border-neutral/20 px-3 py-2.5 text-sm"><option value="">All units</option>{references.units.map((unit) => <option key={unit.unit_id} value={unit.unit_id}>{unit.name}{!isCatalogActive(unit) ? " (archived)" : ""}</option>)}</select></label>}
            <button type="button" disabled={loading || busy} onClick={refresh} aria-label="Refresh catalog" title="Refresh catalog" className="rounded-xl border border-neutral/20 p-2.5 text-neutral/60 hover:bg-base disabled:opacity-40"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg></button>
          </div>
        </div>
        {referencesError && <p role="alert" className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Linked names could not be loaded. {referencesError} Use Refresh to try again.</p>}
        {loadError ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-center"><p className="text-sm text-red-700">{loadError}</p><button type="button" onClick={refresh} className="mt-3 text-sm font-semibold text-primary underline">Try again</button></div> : <div className="overflow-x-auto rounded-xl border border-neutral/10" aria-busy={loading}>
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="border-b border-neutral/10 bg-base/60"><tr>{definition.columns.map((key) => <th key={key} scope="col" className="px-4 py-3 font-medium text-neutral/60">{definition.fields.find((field) => field.key === key)?.label.replace(" (PHP)", "") ?? key}</th>)}<th scope="col" className="px-4 py-3 font-medium text-neutral/60">Status</th><th scope="col" className="px-4 py-3 text-right font-medium text-neutral/60">Actions</th></tr></thead>
            <tbody className="divide-y divide-neutral/10">
              {loading ? <tr><td colSpan={definition.columns.length + 2} className="px-4 py-12 text-center text-neutral/50" role="status">Loading {definition.label.toLowerCase()}...</td></tr> : records.length === 0 ? <tr><td colSpan={definition.columns.length + 2} className="px-4 py-12 text-center"><p className="font-medium text-neutral">{filters.search || filters.unitId ? "No matching items" : `No ${filters.status === "all" ? "" : `${filters.status} `}${definition.label.toLowerCase()} yet`}</p><p className="mt-2 text-sm text-neutral/55">{filters.search || filters.unitId ? "Try another search or clear your filters." : filters.status === "archived" ? "Archived items appear here and can be restored." : `Use Add ${definition.singular} to create your first item.`}</p>{(filters.search || filters.unitId) && <button type="button" onClick={() => { setSearchDraft(""); setFilters((current) => ({ ...current, search: "", unitId: "", page: 1 })); }} className="mt-3 text-sm font-semibold text-primary underline">Clear filters</button>}</td></tr> : records.map((record) => {
                const name = catalogRecordName(filters.resource, record, references); const active = isCatalogActive(record);
                return <tr key={String(record[definition.id])} className="transition hover:bg-base/40">
                  {definition.columns.map((key, index) => <td key={key} className="px-4 py-4 align-top text-neutral/75"><div className={index === 0 ? "flex items-center gap-3" : ""}>
                    {filters.resource === "units" && index === 0 && (isContentImageUrl(record.unit_img) ? <Image src={record.unit_img} alt={String(record.name)} width={44} height={44} unoptimized className="h-11 w-11 shrink-0 rounded-xl object-cover" /> : <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-semibold text-primary" aria-hidden="true">{name.charAt(0)}</span>)}
                    <div className="max-w-md"><p className={index === 0 ? "font-medium text-neutral" : key.includes("price") || key.includes("rate") ? "whitespace-nowrap font-medium tabular-nums" : key.startsWith("effective_") ? "whitespace-nowrap" : "line-clamp-2"}>{displayValue(key, record[key])}</p>{index === 0 && record.description ? <p className="mt-1 line-clamp-2 max-w-sm text-xs leading-relaxed text-neutral/50">{String(record.description)}</p> : null}{filters.resource === "payment_accounts" && index === 0 && <p className="mt-1 text-xs text-neutral/50">{record.qr_image ? "QR image attached" : "No QR image"}</p>}</div>
                  </div></td>)}
                  <td className="px-4 py-4 align-top"><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${active ? "bg-green-50 text-green-700" : "bg-neutral/5 text-neutral/55"}`}><span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-500" : "bg-neutral/35"}`} />{active ? "Active" : "Archived"}</span></td>
                  <td className="whitespace-nowrap px-4 py-4 text-right align-top"><button type="button" disabled={busy} onClick={() => openEditor(record)} aria-label={`Edit ${name}`} className="rounded-xl border border-neutral/15 px-3 py-1.5 text-xs font-medium text-neutral hover:border-primary/40 hover:bg-primary/5">Edit</button><button type="button" disabled={busy} onClick={() => { setAction({ kind: active ? "archive" : "restore", resource: filters.resource, record }); setActionError(null); }} aria-label={`${active ? "Archive" : "Restore"} ${name}`} className={`ml-2 rounded-xl px-3 py-1.5 text-xs font-medium ${active ? "text-neutral/55 hover:bg-red-50 hover:text-red-700" : "text-primary hover:bg-primary/5"}`}>{active ? "Archive" : "Restore"}</button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-neutral/55">
          <p>{loading ? "Loading..." : total === 0 ? "0 items" : `${(filters.page - 1) * PAGE_SIZE + 1}–${Math.min(filters.page * PAGE_SIZE, total)} of ${total} items`}</p>
          <div className="flex items-center gap-2"><button type="button" disabled={loading || filters.page <= 1} onClick={() => { setLoading(true); setFilters((current) => ({ ...current, page: current.page - 1 })); }} className="rounded-xl border border-neutral/15 px-3 py-2 text-xs font-medium hover:bg-base disabled:opacity-40">Previous</button><span className="px-2 text-xs">Page {filters.page} of {lastPage}</span><button type="button" disabled={loading || filters.page >= lastPage} onClick={() => { setLoading(true); setFilters((current) => ({ ...current, page: current.page + 1 })); }} className="rounded-xl border border-neutral/15 px-3 py-2 text-xs font-medium hover:bg-base disabled:opacity-40">Next</button></div>
        </div>
      </div>}
    </section>
    {editor && <CatalogEditorDialog key={editor.resource} resource={editor.resource} record={editor.record} references={references} referencesError={referencesError} busy={busy} error={editorError} onClose={closeEditor} onSave={save} />}
    {action && <CatalogDialog title={`${action.kind === "archive" ? "Archive" : "Restore"} ${catalogResources[action.resource].singular}`} description={actionDescription} busy={busy} onClose={closeAction}>
      {actionError && <p role="alert" className="mb-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{actionError}</p>}
      <div className="flex justify-end gap-3"><button type="button" data-autofocus onClick={closeAction} disabled={busy} className="rounded-xl border border-neutral/20 px-5 py-2.5 text-sm font-medium hover:bg-base disabled:opacity-40">Cancel</button><button type="button" onClick={() => void confirmAction()} disabled={busy} className={`rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${action.kind === "archive" ? "bg-red-700 hover:bg-red-800" : "bg-primary hover:bg-primary/90"}`}>{busy ? "Processing..." : action.kind === "archive" ? "Archive item" : "Restore item"}</button></div>
    </CatalogDialog>}
  </div>;
}
