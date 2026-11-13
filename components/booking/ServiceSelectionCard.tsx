"use client";

import ManageIcon from "@/components/manage/ManageIcon";

import ServicePhoto from "./ServicePhoto";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { serviceQuantityLimit } from "@/lib/booking/service-quantity";

function PhotoPreview({ name, src, onClose }: { name: string; src: string | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.body.style.overflow = overflow; previousFocus?.focus(); };
  }, []);
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-2xl border-0 bg-white p-0 text-neutral shadow-2xl backdrop:bg-black/65">
    <div>
      <div className="flex items-center justify-between gap-4 border-b border-neutral/10 px-5 py-3">
        <h2 id={titleId} className="min-w-0 break-words font-semibold">{name}</h2>
        <button type="button" onClick={onClose} aria-label="Close photo preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-primary"><ManageIcon name="close" /></button>
      </div>
      <div className="h-[65dvh] max-h-[640px]" role="img" aria-label={`${name} photo`}><ServicePhoto src={src} enlarged /></div>
    </div>
  </dialog>, document.body);
}

interface Props {
  service: { id: string; name: string; description: string; price: number; imageUrl: string | null; maxQuantity?: number };
  selected: boolean;
  onToggle: () => void;
  quantity?: number;
  onQuantityChange?: (quantity: number) => void;
}

export default function ServiceSelectionCard({ service, selected, onToggle, quantity = 1, onQuantityChange }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const limit = serviceQuantityLimit(service.maxQuantity);
  const money = (amount: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(amount);
  return <><div className={`flex h-full flex-col overflow-hidden rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${selected ? "border-primary bg-primary/5" : "border-neutral/20 bg-white hover:border-primary/60 hover:bg-primary/5"}`}>
    <button type="button" onClick={() => setPreviewOpen(true)} aria-label={`View ${service.name} photo`} aria-haspopup="dialog" style={{ display: "block", width: "100%", height: "clamp(11rem, 25vw, 13rem)" }} className="relative shrink-0 cursor-zoom-in overflow-hidden bg-stone-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"><ServicePhoto src={service.imageUrl} /></button>
    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 p-4">
      <span className="flex min-w-0 flex-1 flex-col self-stretch">
        <span className="block wrap-break-word font-semibold text-neutral">{service.name}</span>
        {service.description && <span className="mt-1 block whitespace-pre-line break-words text-sm leading-relaxed text-neutral/65">{service.description}</span>}
        <span className="ui-nowrap mt-auto block max-w-full overflow-x-auto pt-3 text-sm font-semibold text-primary">{money(service.price)} each</span>
      </span>
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Add ${service.name}`} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
    </label>
    {selected && onQuantityChange && <div className="border-t border-neutral/10 px-4 pb-4 pt-3">
      <label className="block text-sm font-medium text-neutral" htmlFor={`service-quantity-${service.id}`}>Quantity <span className="text-xs font-normal text-neutral/60">(max {limit} per booking)</span></label>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" aria-label={`Decrease ${service.name} quantity`} disabled={quantity <= 1} onClick={() => onQuantityChange(Math.max(1, quantity - 1))} className="h-11 w-11 shrink-0 rounded-lg border border-neutral/20 text-xl hover:bg-base disabled:opacity-40">−</button>
        <input id={`service-quantity-${service.id}`} name={`serviceQuantity-${service.id}`} aria-label={`Quantity for ${service.name}`} type="number" min={1} max={limit} step={1} required value={Number.isFinite(quantity) ? quantity : ""} onChange={event => onQuantityChange(Number(event.target.value))} className="h-11 w-full min-w-0 rounded-lg border border-neutral/20 px-2 text-center focus:border-primary focus:outline-primary" />
        <button type="button" aria-label={`Increase ${service.name} quantity`} disabled={quantity >= limit} onClick={() => onQuantityChange(Math.min(limit, Math.max(1, quantity + 1)))} className="h-11 w-11 shrink-0 rounded-lg border border-neutral/20 text-xl hover:bg-base disabled:opacity-40">+</button>
      </div>
      <p className="mt-2 text-sm font-semibold text-primary" aria-live="polite">Line total: {money(service.price * Math.max(0, Number.isFinite(quantity) ? quantity : 0))}</p>
    </div>}
  </div>{previewOpen && <PhotoPreview name={service.name} src={service.imageUrl} onClose={closePreview} />}</>;
}
