"use client";

import UnitPhoto from "./UnitPhoto";

interface Props {
  unit: { id: string; name: string; description: string; capacity: number | null; imageUrl: string | null };
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export default function UnitSelectionCard({ unit, selected, disabled = false, onSelect }: Props) {
  return <label className={`flex h-full min-w-0 flex-col overflow-hidden rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${disabled ? "cursor-wait opacity-60" : "cursor-pointer"} ${selected ? "border-primary bg-primary/5" : "border-neutral/20 bg-white hover:border-primary/60"}`}>
    <span className="relative block shrink-0 overflow-hidden bg-stone-100" style={{ width: "100%", height: "clamp(11rem, 25vw, 14rem)" }}>
      <UnitPhoto src={unit.imageUrl} />
      {selected && <span aria-hidden="true" className="absolute right-3 top-3 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white shadow-sm">Selected</span>}
    </span>
    <span className="flex flex-1 items-start gap-3 p-4">
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold text-neutral">{unit.name}</span>
        {unit.capacity !== null && unit.capacity > 0 && <span className="mt-1 block text-xs font-medium text-primary">Room capacity: {unit.capacity} {unit.capacity === 1 ? "guest" : "guests"}</span>}
        {unit.description && <span className="mt-2 block whitespace-pre-line break-words text-sm leading-relaxed text-neutral/65">{unit.description}</span>}
      </span>
      <input type="radio" name="roomType" value={unit.id} checked={selected} onChange={onSelect} disabled={disabled} required aria-label={`Select ${unit.name}`} className="mt-1 h-5 w-5 shrink-0 accent-primary" />
    </span>
  </label>;
}
