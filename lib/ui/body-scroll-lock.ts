// Each overlay owns a lock. Restore the original style only after the last
// overlay closes, regardless of React's parent/child cleanup order.
const locks = new WeakMap<HTMLElement, { owners: Set<symbol>; overflow: string; priority: string }>();

export function lockBodyScroll(body: HTMLElement = document.body): () => void {
  let lock = locks.get(body);
  if (!lock) {
    lock = { owners: new Set(), overflow: body.style.getPropertyValue("overflow"), priority: body.style.getPropertyPriority("overflow") };
    locks.set(body, lock);
  }
  const owner = Symbol("scroll-lock");
  lock.owners.add(owner);
  body.style.setProperty("overflow", "hidden");
  return () => {
    if (!lock.owners.delete(owner) || lock.owners.size > 0) return;
    if (lock.overflow) body.style.setProperty("overflow", lock.overflow, lock.priority);
    else body.style.removeProperty("overflow");
    locks.delete(body);
  };
}
