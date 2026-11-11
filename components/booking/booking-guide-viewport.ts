/** Keep tour explanations within the visible screen after Driver scrolls or resizes. */
export function keepBookingPopoverInView(element: HTMLElement) {
  let frame = 0;
  const fit = () => {
    frame = 0;
    if (!element.isConnected) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
    const width = Math.min(document.documentElement.clientWidth || window.innerWidth, viewport?.width ?? window.innerWidth);
    const height = viewport?.height ?? window.innerHeight;
    const rect = element.getBoundingClientRect();
    const x = Math.max(left + 12, Math.min(rect.left, left + width - rect.width - 12));
    const y = Math.max(top + 12, Math.min(rect.top, top + height - rect.height - 12));
    if (Math.abs(x - rect.left) > 0.5) { element.style.left = `${x}px`; element.style.right = "auto"; }
    if (Math.abs(y - rect.top) > 0.5) { element.style.top = `${y}px`; element.style.bottom = "auto"; }
  };
  const schedule = () => { if (!frame) frame = window.requestAnimationFrame(fit); };
  const position = new window.MutationObserver(schedule);
  position.observe(element, { attributes: true, attributeFilter: ["style"] });
  const size = window.ResizeObserver ? new window.ResizeObserver(schedule) : null;
  size?.observe(element);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  schedule();
  return () => {
    position.disconnect(); size?.disconnect();
    window.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("resize", schedule);
    window.visualViewport?.removeEventListener("scroll", schedule);
    if (frame) window.cancelAnimationFrame(frame);
  };
}
