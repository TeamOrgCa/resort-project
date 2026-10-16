"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;

// Client components also render on the server. Keep the first hydration render
// identical to the server, then enable portals and their focus effects together.
export function usePortalTarget(): HTMLElement | null {
  const ready = useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
  return ready ? document.body : null;
}
