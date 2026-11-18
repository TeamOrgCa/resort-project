/** Scroll the visible desktop/mobile card, including its horizontal scroll pane. */
export function focusCalendarNotification(root: HTMLElement, reservationId: string, date: string, reducedMotion = false) {
  const target = [...root.querySelectorAll<HTMLElement>("[data-calendar-event]")].find(element =>
    element.dataset.calendarEvent === `${reservationId}:${date}` && element.getClientRects().length > 0
  );
  if (!target) return false;
  target.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "center", inline: "center" });
  target.focus({ preventScroll: true });
  return true;
}
