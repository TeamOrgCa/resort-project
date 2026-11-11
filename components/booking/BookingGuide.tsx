"use client";

import { useEffect, useRef, useState } from "react";
import type { Driver } from "driver.js";
import { bookingGuide, type BookingGuidePage } from "./booking-guide";
import { keepBookingPopoverInView } from "./booking-guide-viewport";

export default function BookingGuide({ page, saved = false, balance = false, disabled = false }: {
  page: BookingGuidePage; saved?: boolean; balance?: boolean; disabled?: boolean;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const tour = useRef<Driver | null>(null);
  const request = useRef(0);
  const starting = useRef(false);
  const restoreFocus = useRef(false);
  const stopFitting = useRef<(() => void) | null>(null);
  const context = `${page}:${saved}:${balance}:${disabled}`;
  const [state, setState] = useState({ context, status: "idle", error: "" });
  const status = state.context === context ? state.status : "idle";
  const guide = bookingGuide(page, saved, balance);

  useEffect(() => {
    if (status === "idle" && restoreFocus.current) {
      restoreFocus.current = false;
      trigger.current?.focus({ preventScroll: true });
    }
  }, [status]);

  useEffect(() => () => {
    // Ignore an import that finishes after navigation or a payment/save begins.
    request.current++;
    starting.current = false;
    stopFitting.current?.();
    stopFitting.current = null;
    tour.current?.destroy();
    tour.current = null;
  }, [context]);

  const start = async () => {
    if (disabled || starting.current || tour.current?.isActive()) return;
    const id = ++request.current;
    starting.current = true;
    setState({ context, status: "loading", error: "" });
    try {
      const { driver } = await import("driver.js");
      if (request.current !== id) return;
      const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const steps = guide.steps.filter(step => {
        const target = document.querySelector(step.element as string);
        return target && target.getClientRects().length > 0 && !target.closest('[hidden], [aria-hidden="true"]');
      });
      const instance = driver({
        steps: [{ popover: { title: guide.title, description: guide.description } }, ...steps],
        animate: !reducedMotion,
        smoothScroll: false,
        overlayColor: "#231a14",
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 14,
        popoverClass: "booking-guide-popover",
        showProgress: true,
        progressText: "{{current}} of {{total}}",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: "Finish guide",
        closeBtnLabel: "Close booking guide",
        allowClose: true,
        allowKeyboardControl: true,
        disableActiveInteraction: true,
        onInteraction: () => false,
        onPopoverRender: popover => {
          popover.wrapper.setAttribute("data-no-auto-scroll", "");
          stopFitting.current?.();
          stopFitting.current = keepBookingPopoverInView(popover.wrapper);
        },
        onDestroyed: () => {
          if (request.current !== id) return;
          stopFitting.current?.();
          stopFitting.current = null;
          tour.current = null;
          restoreFocus.current = true;
          setState({ context, status: "idle", error: "" });
        },
      });
      tour.current = instance;
      setState({ context, status: "active", error: "" });
      instance.drive();
    } catch {
      if (request.current !== id) return;
      tour.current?.destroy();
      tour.current = null;
      setState({ context, status: "idle", error: "The guide couldn't load. Try Booking guide again." });
    } finally {
      if (request.current === id) starting.current = false;
    }
  };

  return <div className="booking-guide-launcher" data-no-auto-scroll hidden={status === "active"}>
    {state.context === context && state.error && <p role="status" className="booking-guide-error">{state.error}</p>}
    <button ref={trigger} type="button" onClick={() => void start()} disabled={disabled || status === "loading"}
      className="booking-guide-button" aria-label="Start booking guide for this page" aria-busy={status === "loading"}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6 shrink-0"><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.7-2.5 1.8-2.5 3.5M12 16.5v.1" /></svg>
      <span>{status === "loading" ? "Opening guide…" : "Booking guide"}</span>
    </button>
  </div>;
}
