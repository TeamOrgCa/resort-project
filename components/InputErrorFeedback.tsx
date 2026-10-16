"use client";

import { useEffect } from "react";

export default function InputErrorFeedback() {
  useEffect(() => {
    let frame: number | null = null;
    const reveal = (element: HTMLElement) => {
      if (frame !== null || element.closest('[hidden], [aria-hidden="true"], [data-no-auto-scroll]')) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (!element.isConnected) return;
        element.style.scrollMarginTop = "7rem";
        if (!element.matches("input, select, textarea, button, a[href], [tabindex]")) element.tabIndex = -1;
        if (element.matches("input, select, textarea") || !document.activeElement?.matches("input, select, textarea")) element.focus({ preventScroll: true });
        element.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      });
    };
    const invalid = (event: Event) => { if (event.target instanceof HTMLElement) reveal(event.target); };
    const observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const element = mutation.target instanceof HTMLElement ? mutation.target : mutation.target.parentElement;
        if (mutation.type === "attributes" && element?.getAttribute("aria-invalid") === "true") { reveal(element); continue; }
        const alert = element?.closest<HTMLElement>('[role="alert"]');
        if (alert?.textContent?.trim()) reveal(alert);
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const candidate = node.matches('[role="alert"]') ? node : node.querySelector<HTMLElement>('[role="alert"]');
          if (candidate?.textContent?.trim()) reveal(candidate);
        }
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["aria-invalid", "role"] });
    document.addEventListener("invalid", invalid, true);
    return () => { observer.disconnect(); document.removeEventListener("invalid", invalid, true); if (frame !== null) window.cancelAnimationFrame(frame); };
  }, []);
  return null;
}
