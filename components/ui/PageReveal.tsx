"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Content stays visible in server HTML and when animation support is unavailable. */
export default function PageReveal({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (motion?.matches || !window.IntersectionObserver) return;
    const targets = [...(root.current?.querySelectorAll<HTMLElement>("[data-reveal]") ?? [])];
    const observer = new window.IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        (entry.target as HTMLElement).dataset.revealState = "visible";
        observer.unobserve(entry.target);
      }
    }, { threshold: 0, rootMargin: "0px 0px -24px 0px" });
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      if (rect.top < window.innerHeight) {
        if (rect.bottom > 0) target.dataset.revealState = "visible";
      } else {
        target.dataset.revealState = "pending";
        observer.observe(target);
      }
    }
    const showAll = () => {
      if (!motion?.matches) return;
      observer.disconnect();
      for (const target of targets) delete target.dataset.revealState;
    };
    const revealFocused = (event: FocusEvent) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>("[data-reveal]");
      if (target) { target.dataset.revealState = "visible"; observer.unobserve(target); }
    };
    const element = root.current;
    element?.addEventListener("focusin", revealFocused);
    motion?.addEventListener("change", showAll);
    return () => {
      observer.disconnect();
      element?.removeEventListener("focusin", revealFocused);
      motion?.removeEventListener("change", showAll);
      for (const target of targets) delete target.dataset.revealState;
    };
  }, []);
  return <div ref={root} className="page-reveal contents">{children}</div>;
}
