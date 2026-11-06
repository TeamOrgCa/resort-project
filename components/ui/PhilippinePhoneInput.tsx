"use client";

import { useId, useState } from "react";
import { normalizePhilippineMobile, philippineMobileInput, PH_MOBILE_ERROR } from "@/lib/validation/phone";

export default function PhilippinePhoneInput({ id, name, value, onChange, required = true, disabled = false }: {
  id?: string; name: string; value: string; onChange: (value: string) => void; required?: boolean; disabled?: boolean;
}) {
  const generatedId = useId(), [touched, setTouched] = useState(false);
  const inputId = id ?? generatedId;
  const invalid = touched && (required || Boolean(value)) && !normalizePhilippineMobile(value);
  return <div>
    <div className={`flex min-h-11 overflow-hidden rounded-lg border bg-white focus-within:ring-2 focus-within:ring-primary ${invalid ? "border-red-500" : "border-neutral/20"}`}>
      <span aria-hidden="true" title="Philippines country code" className="flex shrink-0 items-center border-r border-neutral/15 bg-base px-3 text-sm font-medium text-neutral">+63</span>
      <input id={inputId} name={name} type="tel" inputMode="tel" autoComplete="tel-national" required={required} disabled={disabled}
        value={philippineMobileInput(value)} onChange={event => {
          const next = philippineMobileInput(event.target.value);
          if (next.length <= 10) onChange(next);
        }} onPaste={event => {
          event.preventDefault();
          const pasted = philippineMobileInput(event.clipboardData.getData("text"));
          const input = event.currentTarget;
          const next = input.value.slice(0, input.selectionStart ?? 0) + pasted + input.value.slice(input.selectionEnd ?? input.value.length);
          if (next.length <= 10) onChange(next);
        }} onBlur={() => setTouched(true)}
        maxLength={10} pattern="9[0-9]{9}" title={PH_MOBILE_ERROR} placeholder="9171234567" aria-invalid={invalid || undefined}
        aria-describedby={`${inputId}-hint${invalid ? ` ${inputId}-error` : ""}`}
        className="min-h-11 w-full min-w-0 bg-transparent px-3 py-3 text-[16px] text-neutral outline-none disabled:opacity-60" />
    </div>
    <p id={`${inputId}-hint`} className="mt-1 text-xs text-neutral/60">Philippines (+63). Enter 10 digits starting with 9.</p>
    {invalid && <p id={`${inputId}-error`} role="alert" className="mt-1 text-xs text-red-700">{PH_MOBILE_ERROR}</p>}
  </div>;
}
