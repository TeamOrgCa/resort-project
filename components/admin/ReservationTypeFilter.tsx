"use client";

import { COMMERCIAL_TYPES, type ReservationTypeFilter as Filter } from "@/lib/booking/commercial-types";

export default function ReservationTypeFilter({ value, onChange }: { value: Filter; onChange: (value: Filter) => void }) {
  return <label className="min-w-0 text-sm font-medium">Reservation type
    <select aria-label="Reservation type filter" value={value} onChange={event => onChange(event.target.value as Filter)} className="admin-field mt-1 block w-full">
      <option value="all">All reservation types</option>
      {Object.entries(COMMERCIAL_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select>
  </label>;
}
