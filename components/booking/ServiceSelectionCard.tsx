"use client";

import ServicePhoto from "./ServicePhoto";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
        <button type="button" onClick={onClose} aria-label="Close photo preview" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl hover:bg-neutral/10 focus-visible:outline-2 focus-visible:outline-primary">×</button>
      </div>
      <div className="h-[65dvh] max-h-[640px]" role="img" aria-label={`${name} photo`}><ServicePhoto src={src} enlarged /></div>
    </div>
  </dialog>, document.body);
}

interface Props {
  service: { id: string; name: string; description: string; price: number; imageUrl: string | null };
  selected: boolean;
  onToggle: () => void;
}

export default function ServiceSelectionCard({ service, selected, onToggle }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  return <><div className={`flex items-start gap-3 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-primary/40 ${selected ? "border-primary bg-primary/5" : "border-neutral/20 bg-white hover:border-primary/60 hover:bg-primary/5"}`}>
    <button type="button" onClick={() => setPreviewOpen(true)} aria-label={`View ${service.name} photo`} aria-haspopup="dialog" className="h-20 w-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-primary sm:h-24 sm:w-24"><ServicePhoto src={service.imageUrl} /></button>
    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
    <div className="min-w-0 flex-1">
      <span className="block break-words font-semibold text-neutral">{service.name}</span>
      {service.description && <span className="mt-1 block whitespace-pre-line break-words text-xs leading-relaxed text-neutral/65">{service.description}</span>}
      <span className="mt-2 block text-sm font-semibold text-primary">{new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(service.price)}</span>
    </div>
    <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Add ${service.name}`} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
    </label>
  </div>{previewOpen && <PhotoPreview name={service.name} src={service.imageUrl} onClose={closePreview} />}</>;
}
