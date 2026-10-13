"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/** Deep links select a module tab; local tab buttons still work without a reload. */
export function useModuleTab<T extends string>(fallback: T, targets: Record<string, T>): [T, (tab: T) => void] {
  const params = useSearchParams();
  const routeTab = targets[params?.get("tab") ?? ""] ?? fallback;
  const [selection, setSelection] = useState<{ route: T; tab: T } | null>(null);
  const active = selection?.route === routeTab ? selection.tab : routeTab;
  return [active, tab => setSelection({ route: routeTab, tab })];
}
