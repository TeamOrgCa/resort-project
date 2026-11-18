"use client";

import type { InputHTMLAttributes } from "react";

// Keep native number steppers while rejecting fractions, signs and more than
// two digits. Clearing restores zero immediately so the field is never blank.
export default function GuestCountInput({ value, onValueChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: number; onValueChange: (value: number) => void;
}) {
  return <input {...props} type="number" inputMode="numeric" step={1} value={value}
    onKeyDown={event => { if (["e", "E", "+", "-", ".", ","].includes(event.key)) event.preventDefault(); }}
    onChange={event => {
      const raw = event.currentTarget.value;
      if (/^\d{0,2}$/.test(raw)) onValueChange(raw === "" ? 0 : Number(raw));
      else event.currentTarget.value = String(value);
    }} />;
}
