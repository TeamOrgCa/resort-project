"use client";
import { useEffect, useState } from "react";
import type { Room, RoomActivity } from "@/lib/rooms/types";
import { roomDate } from "@/lib/rooms/occupancy";

export default function RoomHistory({ rooms, roomId = "", canExport }: { rooms: Room[]; roomId?: string; canExport: boolean }) {
  const [room, setRoom] = useState(roomId), [q, setQ] = useState(""), [type, setType] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState(""), [page, setPage] = useState(1);
  const [data, setData] = useState<{ records: RoomActivity[]; count: number } | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const params = new URLSearchParams({ room, q, type, from, to, page: String(page) }).toString();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true); setError("");
      fetch(`/api/admin/rooms/history?${params}`, { signal: controller.signal }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.message); setData(d); }).catch(e => { if (e.name !== "AbortError") setError(e.message); }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [params]);
  return <section className="rounded-2xl border border-neutral/10 bg-white p-4 sm:p-6">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Room activity history</h2>{canExport && <button className="admin-button-secondary" onClick={async () => {
      try { const response = await fetch(`/api/admin/rooms/history?${params}&export=csv`); if (!response.ok) throw new Error((await response.json()).message); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "marville-room-history.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { setError(e instanceof Error ? e.message : "Export failed."); }
    }}>Export CSV</button>}</div>
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <label className="text-sm">Search<input className="admin-field mt-1 w-full" value={q} onChange={e => { setQ(e.target.value); setPage(1); }} placeholder="Reference, activity or staff" /></label>
      <label className="text-sm">Room<select className="admin-field mt-1 w-full" value={room} onChange={e => { setRoom(e.target.value); setPage(1); }}><option value="">All rooms</option>{rooms.map(r => <option key={r.room_id} value={r.room_id}>{r.room_number}</option>)}</select></label>
      <label className="text-sm">Activity<select className="admin-field mt-1 w-full" value={type} onChange={e => { setType(e.target.value); setPage(1); }}><option value="">All activities</option>{["reservation_created", "reservation_released", "rescheduled", "check_in", "check_out", "extension", "transfer", "additional_charge", "cleaning", "ready", "maintenance", "complete_maintenance", "configure", "inventory", "deactivate", "reactivate"].map(t => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}</select></label>
      <label className="text-sm">From<input type="date" className="admin-field mt-1 w-full" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }} /></label><label className="text-sm">Through<input type="date" className="admin-field mt-1 w-full" value={to} onChange={e => { setTo(e.target.value); setPage(1); }} /></label>
    </div>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <div className="max-h-[65vh] overflow-auto rounded-xl border border-neutral/10" aria-busy={busy}><table className="w-full min-w-[700px] text-left text-sm"><thead className="sticky top-0 bg-base"><tr>{["Date & time (PHT)", "Room", "Activity", "Reservation", "Description", "Staff"].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody>{data?.records.map(a => <tr key={a.activity_id} className="border-t border-neutral/10"><td className="p-3">{roomDate(a.created_at)}</td><td className="p-3">{rooms.find(r => r.room_id === a.room_id)?.room_number ?? "—"}</td><td className="p-3 capitalize">{a.activity_type.replaceAll("_", " ")}</td><td className="p-3">{a.reference_number ?? "—"}</td><td className="p-3">{a.description}</td><td className="p-3">{a.staff_name}</td></tr>)}</tbody></table>{!data?.records.length && <p className="p-8 text-center text-sm text-neutral/60">{busy ? "Loading history…" : "No matching room activities."}</p>}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"><span>{data?.count ?? 0} activities · Page {page} of {Math.max(1, Math.ceil((data?.count ?? 0) / 30))}</span><div className="flex gap-2"><button className="admin-button-secondary" disabled={page <= 1 || busy} onClick={() => setPage(p => p - 1)}>Previous</button><button className="admin-button-secondary" disabled={page * 30 >= (data?.count ?? 0) || busy} onClick={() => setPage(p => p + 1)}>Next</button></div></div>
  </section>;
}
