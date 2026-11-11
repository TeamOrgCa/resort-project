"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmationDialog from "./ConfirmationDialog";

type Confirmation = { title: string; message: string; confirmText?: string; cancelText?: string };

export function useActionConfirmation() {
  const [options, setOptions] = useState<Confirmation | null>(null);
  const pending = useRef<((confirmed: boolean) => void) | null>(null);
  const confirm = useCallback((next: Confirmation): Promise<boolean> => {
    if (pending.current) return Promise.resolve(false);
    return new Promise(resolve => { pending.current = resolve; setOptions(next); });
  }, []);
  const finish = useCallback((confirmed: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(confirmed);
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  return { confirm, confirmation: options && <ConfirmationDialog isOpen {...options} cancelText={options.cancelText ?? "Keep editing"} onCancel={() => finish(false)} onConfirm={() => finish(true)} /> };
}
