"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AdminSectionHeader from "@/components/admin/AdminSectionHeader";

const tabs = [
  ["services", "Services"], ["units", "Units"], ["unit_rates", "Unit rates"], ["guest_rates", "Guest rates"],
  ["payment_methods", "Payment methods"], ["payment_accounts", "Payment accounts"], ["reservation_policies", "Policies"], ["ocular_time_slots", "Ocular slots"],
] as const;
type Resource = (typeof tabs)[number][0];
type RecordData = Record<string, unknown>;

const fields: Record<Resource, string[]> = {
  services: ["name", "description", "price"],
  units: ["name", "description", "capacity", "base_price", "unit_img"],
  unit_rates: ["unit_id", "price", "effective_from", "effective_to"],
  guest_rates: ["adult_rate", "child_rate", "effective_from", "effective_to"],
  payment_methods: ["name", "type"],
  payment_accounts: ["payment_method_id", "account_name", "account_number", "instructions"],
  reservation_policies: ["title", "content", "display_order"],
  ocular_time_slots: ["start_time", "end_time", "max_capacity"],
};
const numericFields = new Set(["price", "base_price", "capacity", "max_capacity", "adult_rate", "child_rate", "display_order"]);
const labels: Record<string, string> = { unit_id: "Unit", payment_method_id: "Payment method", effective_from: "Effective from", effective_to: "Effective to", base_price: "Base price", max_capacity: "Maximum capacity", display_order: "Display order", unit_img: "Unit image URL" };
const resourceId = (resource: Resource) => ({ services: "service_id", units: "unit_id", unit_rates: "unit_rate_id", guest_rates: "rate_id", payment_methods: "payment_method_id", payment_accounts: "account_id", reservation_policies: "policy_id", ocular_time_slots: "slot_id" })[resource];

export default function CatalogPage() {
  const [resource, setResource] = useState<Resource>("services");
  const [records, setRecords] = useState<RecordData[]>([]);
  const [draft, setDraft] = useState<RecordData>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [units, setUnits] = useState<Array<{ unit_id: string; name: string }>>([]);
  const [paymentMethods, setPaymentMethods] = useState<Array<{ payment_method_id: string; name: string }>>([]);
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [message, setMessage] = useState("Loading records...");

  const load = useCallback(async () => {
    setMessage("Loading records...");
    const response = await fetch(`/api/admin/catalog?resource=${resource}&page=${page}&pageSize=25`, { cache: "no-store" });
    const result = (await response.json()) as { records?: RecordData[]; total?: number; message?: string };
    if (!response.ok) { setMessage(result.message ?? "Unable to load records."); return; }
    setRecords(result.records ?? []); setTotal(result.total ?? 0); setMessage(`${result.total ?? 0} records`);
  }, [page, resource]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => {
    const loadReferences = async () => {
      const response = await fetch("/api/catalog", { cache: "no-store" });
      const result = (await response.json()) as { catalog?: { units?: Array<{ unit_id: string; name: string }>; paymentMethods?: Array<{ payment_method_id: string; name: string }> } };
      setUnits(result.catalog?.units ?? []); setPaymentMethods(result.catalog?.paymentMethods ?? []);
    };
    void loadReferences();
  }, []);

  const visibleFields = useMemo(() => fields[resource].filter((field) => field !== "unit_id" && field !== "payment_method_id"), [resource]);
  const setField = (key: string, value: unknown) => setDraft((current) => ({ ...current, [key]: value }));
  const reset = () => { setDraft({}); setEditingId(null); setQrFile(null); };

  const save = async () => {
    if (resource === "unit_rates" && !draft.unit_id) { setMessage("Select a unit before saving."); return; }
    if (resource === "payment_accounts" && !draft.payment_method_id) { setMessage("Select a payment method before saving."); return; }
    const record = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== "" && value !== undefined).map(([key, value]) => [key, numericFields.has(key) ? Number(value) : value]));
    const response = await fetch("/api/admin/catalog", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingId ? { resource, id: editingId, record } : { resource, record }) });
    const result = (await response.json()) as { success?: boolean; record?: RecordData; message?: string };
    if (!response.ok || !result.success) { setMessage(result.message ?? "Unable to save record."); return; }
    const accountId = editingId ?? String(result.record?.account_id ?? "");
    if (resource === "payment_accounts" && qrFile && accountId) {
      const formData = new FormData(); formData.append("accountId", accountId); formData.append("file", qrFile);
      const qrResponse = await fetch("/api/admin/payment-accounts/qr", { method: "POST", body: formData });
      if (!qrResponse.ok) { setMessage("Account saved, but QR upload failed."); reset(); await load(); return; }
    }
    setMessage("Saved successfully."); reset(); await load();
  };

  const archive = async (id: string) => { const response = await fetch(`/api/admin/catalog?resource=${resource}&id=${id}`, { method: "DELETE" }); setMessage(response.ok ? "Archived." : "Unable to archive record."); await load(); };
  const formatValue = (field: string, value: unknown) => field === "unit_id" ? units.find((unit) => unit.unit_id === value)?.name ?? "Unknown unit" : field === "payment_method_id" ? paymentMethods.find((method) => method.payment_method_id === value)?.name ?? "Unknown method" : String(value ?? "-");
  const recordKey = (record: RecordData, index: number) => {
    const value = record[resourceId(resource)];
    return typeof value === "string" && value.trim() ? value : `${resource}-${page}-${index}`;
  };

  return <div>
    <AdminSectionHeader title="Business Catalog" subtitle="Manage services, units, rates, payment channels, policies, and ocular schedules." />
    <section className="rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6">
      <div className="flex gap-2 overflow-x-auto border-b border-neutral/10 pb-4">{tabs.map(([key, label]) => <button key={key} type="button" onClick={() => { setResource(key); setPage(1); reset(); }} className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold ${resource === key ? "bg-primary text-base" : "bg-base text-neutral hover:bg-neutral/10"}`}>{label}</button>)}</div>
      <div className="my-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {resource === "unit_rates" ? <label className="text-sm font-semibold text-neutral">Unit<select value={String(draft.unit_id ?? "")} onChange={(event) => setField("unit_id", event.target.value)} className="mt-1 w-full rounded-lg border border-neutral/20 px-3 py-2 font-normal"><option value="">Select unit</option>{units.map((unit) => <option key={unit.unit_id} value={unit.unit_id}>{unit.name}</option>)}</select></label> : null}
        {resource === "payment_accounts" ? <label className="text-sm font-semibold text-neutral">Payment method<select value={String(draft.payment_method_id ?? "")} onChange={(event) => setField("payment_method_id", event.target.value)} className="mt-1 w-full rounded-lg border border-neutral/20 px-3 py-2 font-normal"><option value="">Select method</option>{paymentMethods.map((method) => <option key={method.payment_method_id} value={method.payment_method_id}>{method.name}</option>)}</select></label> : null}
        {visibleFields.map((field) => <label key={field} className="text-sm font-semibold capitalize text-neutral">{labels[field] ?? field.replaceAll("_", " ")}<input type={field.includes("date") ? "date" : field.includes("time") ? "time" : numericFields.has(field) ? "number" : "text"} value={String(draft[field] ?? "")} onChange={(event) => setField(field, event.target.value)} className="mt-1 w-full rounded-lg border border-neutral/20 px-3 py-2 font-normal" /></label>)}
        {resource === "payment_accounts" ? <label className="text-sm font-semibold text-neutral">QR code image<input type="file" accept="image/*" onChange={(event) => setQrFile(event.target.files?.[0] ?? null)} className="mt-1 w-full rounded-lg border border-neutral/20 px-3 py-2 font-normal" /></label> : null}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-2"><button type="button" onClick={() => void save()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-base">{editingId ? "Update" : "Create"}</button><button type="button" onClick={reset} className="rounded-lg bg-base px-4 py-2 text-sm font-semibold text-neutral">Clear</button><span className="text-sm text-neutral/60">{message}</span></div>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-neutral/10">{visibleFields.slice(0, 4).map((field) => <th key={field} className="px-3 py-2 font-semibold text-neutral">{labels[field] ?? field}</th>)}<th className="px-3 py-2">Actions</th></tr></thead><tbody>{records.map((record, index) => { const id = record[resourceId(resource)]; const idText = typeof id === "string" ? id : ""; return <tr key={recordKey(record, index)} className="border-b border-neutral/10">{visibleFields.slice(0, 4).map((field) => <td key={field} className="px-3 py-3 text-neutral/80">{formatValue(field, record[field])}</td>)}<td className="whitespace-nowrap px-3 py-3"><button type="button" disabled={!idText} onClick={() => { setEditingId(idText); setDraft(Object.fromEntries(fields[resource].map((field) => [field, record[field] ?? ""]))); }} className="mr-3 font-semibold text-primary disabled:opacity-40">Edit</button><button type="button" disabled={!idText} onClick={() => void archive(idText)} className="font-semibold text-neutral disabled:opacity-40">Archive</button></td></tr>; })}</tbody></table></div>
      <div className="mt-4 flex items-center gap-3"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg bg-base px-3 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-sm text-neutral/60">Page {page} of {Math.max(1, Math.ceil(total / 25))}</span><button type="button" disabled={page * 25 >= total} onClick={() => setPage((value) => value + 1)} className="rounded-lg bg-base px-3 py-2 text-sm disabled:opacity-40">Next</button></div>
    </section>
  </div>;
}
