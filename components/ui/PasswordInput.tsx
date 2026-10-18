"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

export default function PasswordInput({ id, className = "", disabled, autoComplete = "current-password", ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? "Hide password" : "Show password";

  return <div className="relative">
    <input autoCapitalize="none" autoCorrect="off" spellCheck={false} {...props} id={inputId} type={visible ? "text" : "password"} disabled={disabled} autoComplete={autoComplete} className={`${className} min-h-11 pr-12`} />
    <button type="button" onClick={() => setVisible(value => !value)} disabled={disabled} aria-label={toggleLabel} title={toggleLabel} aria-controls={inputId} aria-pressed={visible}
      className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-neutral/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {visible && <path d="m3 3 18 18" />}
      </svg>
    </button>
  </div>;
}
