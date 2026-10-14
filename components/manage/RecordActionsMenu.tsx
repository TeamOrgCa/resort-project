"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ManageIcon, { type ManageIconName } from "./ManageIcon";
export type RecordAction = { label: string; icon: ManageIconName; onSelect: () => void; disabled?: boolean; explanation?: string; danger?: boolean };

export default function RecordActionsMenu({ reference, actions }: { reference: string; actions: RecordAction[] }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId();
  function close(restore = false) { setPosition(null); if (restore) trigger.current?.focus(); }
  function open() {
    if (position) { close(); return; }
    const rect = trigger.current?.getBoundingClientRect(); if (!rect) return;
    const width = Math.min(288, window.innerWidth - 16), height = Math.min(actions.length * 64 + 56, window.innerHeight - 16);
    setPosition({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 8 + height <= window.innerHeight ? rect.bottom + 8 : rect.top - height, window.innerHeight - height - 8)) });
  }
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) setPosition(null);
    };
    const dismiss = () => setPosition(null);
    document.addEventListener("pointerdown", outside); window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss); // Window scrolling closes the floating menu; menu scrolling remains usable.
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", dismiss); window.removeEventListener("scroll", dismiss); };
  }, [position]);
  return <>
    <button ref={trigger} type="button" aria-label={`Options for ${reference}`} aria-haspopup="menu" aria-expanded={Boolean(position)} aria-controls={position ? id : undefined}
      onClick={open} onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); open(); } }}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral/10 bg-white text-neutral/70 transition hover:border-primary/30 hover:bg-primary/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <ManageIcon name="more" />
    </button>
    {position && createPortal(<div ref={menu} id={id} role="menu" aria-label={`Actions for ${reference}`} style={{ ...position, maxHeight: Math.max(0, window.innerHeight - position.top - 8) }}
      className="fixed z-[80] max-h-[calc(100dvh-16px)] w-72 max-w-[calc(100vw-16px)] overflow-y-auto overscroll-contain rounded-2xl border border-neutral/10 bg-white p-2 shadow-2xl"
      onKeyDown={event => {
        if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); close(true); return; }
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault(); const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
            : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[index]?.focus();
        }
      }}>
      <p className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-neutral/45">Booking options</p>
      {actions.map(action => <button key={action.label} type="button" role="menuitem" disabled={action.disabled} title={action.explanation}
        onClick={() => { close(true); action.onSelect(); }}
        className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-45 ${action.danger ? "text-red-700 hover:bg-red-50" : "text-neutral hover:bg-base"}`}>
        <ManageIcon name={action.icon} className="mt-0.5 h-5 w-5 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]"><span className="block text-sm font-semibold">{action.label}</span>{action.explanation && <span className="mt-0.5 block text-xs font-normal text-neutral/60">{action.explanation}</span>}</span>
      </button>)}
    </div>, document.body)}
  </>;
}
