"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { containsEmoji, EMOJI_INPUT_MESSAGE, removeEmoji } from "@/lib/validation/emoji";
import { EMAIL_INPUT_ERROR, hasEmailWhitespace, sanitizeEmailInput } from "@/lib/validation/email";

const textTypes = new Set(["text", "search", "email", "password", "tel", "url"]);
function textField(target: EventTarget | null): HTMLInputElement | HTMLTextAreaElement | null {
  if (target instanceof HTMLTextAreaElement) return target;
  return target instanceof HTMLInputElement && textTypes.has(target.type) ? target : null;
}

export default function TextInputGuard() {
  const [notice, setNotice] = useState(0);
  const [message, setMessage] = useState(EMOJI_INPUT_MESSAGE);
  useEffect(() => {
    const previous = new WeakMap<HTMLInputElement | HTMLTextAreaElement, string>();
    const warn = (message = EMOJI_INPUT_MESSAGE) => { setMessage(message); setNotice(current => current + 1); };
    const invalidMessage = (field: HTMLInputElement | HTMLTextAreaElement, value: string) =>
      containsEmoji(value) ? EMOJI_INPUT_MESSAGE
        : field instanceof HTMLInputElement && field.type === "email" && hasEmailWhitespace(value) ? EMAIL_INPUT_ERROR : null;
    const remember = (event: Event) => {
      const field = textField(event.target);
      if (field && !invalidMessage(field, field.value)) previous.set(field, field.value);
    };
    const reject = (event: Event, text: string | null) => {
      const field = textField(event.target);
      if (!field || !text) return;
      const message = invalidMessage(field, text);
      if (!message) return;
      event.preventDefault(); event.stopImmediatePropagation(); warn(message);
    };
    const beforeInput = (event: Event) => {
      remember(event);
      const input = event as InputEvent;
      if (!input.isComposing) reject(event, input.data);
    };
    const paste = (event: ClipboardEvent) => reject(event, event.clipboardData?.getData("text/plain") ?? null);
    const drop = (event: DragEvent) => reject(event, event.dataTransfer?.getData("text/plain") ?? null);
    const cleanInput = (event: Event) => {
      const field = textField(event.target);
      if (!field || (event as InputEvent).isComposing) return;
      const message = invalidMessage(field, field.value);
      if (!message) { previous.set(field, field.value); return; }
      const password = field instanceof HTMLInputElement && field.type === "password";
      // Reject password changes as a whole; never silently create a different password.
      const withoutEmoji = removeEmoji(field.value);
      const clean = password ? previous.get(field) ?? ""
        : field instanceof HTMLInputElement && field.type === "email" ? sanitizeEmailInput(withoutEmoji) : withoutEmoji;
      const caret = field.selectionStart === null ? null : removeEmoji(field.value.slice(0, field.selectionStart)).length;
      const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, clean);
      if (caret !== null) {
        try { field.setSelectionRange(Math.min(caret, clean.length), Math.min(caret, clean.length)); } catch { /* Email inputs do not support selection ranges. */ }
      }
      previous.set(field, clean); warn(message);
      // Native setters allow React's controlled onChange to receive the cleaned value.
      if (event.type === "compositionend") field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const submit = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      const invalid = [...event.target.querySelectorAll("input, textarea")].find(field => {
        const input = textField(field);
        return input && !input.disabled && invalidMessage(input, input.value);
      });
      const input = textField(invalid ?? null);
      if (input) { event.preventDefault(); event.stopImmediatePropagation(); input.focus(); warn(invalidMessage(input, input.value) ?? undefined); }
    };
    document.addEventListener("focusin", remember, true);
    document.addEventListener("beforeinput", beforeInput, true);
    document.addEventListener("paste", paste, true);
    document.addEventListener("drop", drop, true);
    document.addEventListener("input", cleanInput, true);
    document.addEventListener("compositionend", cleanInput, true);
    document.addEventListener("submit", submit, true);
    return () => {
      document.removeEventListener("focusin", remember, true);
      document.removeEventListener("beforeinput", beforeInput, true);
      document.removeEventListener("paste", paste, true);
      document.removeEventListener("drop", drop, true);
      document.removeEventListener("input", cleanInput, true);
      document.removeEventListener("compositionend", cleanInput, true);
      document.removeEventListener("submit", submit, true);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(0), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return notice ? createPortal(<div role="alert" data-no-auto-scroll className="fixed bottom-4 left-1/2 z-[200] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-start gap-3 rounded-xl border border-red-200 bg-white p-4 text-sm text-red-800 shadow-xl">
    <span className="flex-1">{message}</span>
    <button type="button" aria-label="Dismiss input notice" onClick={() => setNotice(0)} className="min-h-11 shrink-0 rounded-lg px-3 font-semibold hover:bg-red-50">Dismiss</button>
  </div>, document.body) : null;
}
