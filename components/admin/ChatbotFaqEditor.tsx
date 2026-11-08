"use client";

export default function ChatbotFaqEditor({ value, onChange }: { value: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const entries = Object.entries(value);
  return <div className="mt-3 space-y-4">
    {entries.map(([question, answer], index) => <div key={index} className="rounded-xl border border-neutral/15 bg-base p-3">
      <label className="block text-sm font-medium">Question {index + 1}<input aria-label={`FAQ question ${index + 1}`} maxLength={200} value={question} onChange={event => {
        const next = event.target.value;
        if (next === question || !(next in value)) onChange(Object.fromEntries(entries.map(([key, text], position) => [position === index ? next : key, text])));
      }} className="admin-field mt-1 w-full" /></label>
      <label className="mt-3 block text-sm font-medium">Approved answer<textarea aria-label={`FAQ answer ${index + 1}`} rows={4} maxLength={2000} value={typeof answer === "string" ? answer : ""} onChange={event => onChange({ ...value, [question]: event.target.value })} className="admin-field mt-1 w-full" /></label>
      <button type="button" onClick={() => onChange(Object.fromEntries(entries.filter((_, position) => position !== index)))} className="mt-2 min-h-11 rounded-lg border border-red-200 px-3 text-sm text-red-700">Remove FAQ {index + 1}</button>
    </div>)}
    <button type="button" disabled={entries.length >= 40} onClick={() => {
      let index = entries.length + 1; while (`New question ${index}` in value) index++;
      onChange({ ...value, [`New question ${index}`]: "" });
    }} className="admin-button-secondary">Add FAQ</button>
    <p className="text-xs text-neutral/65">Save this section to publish answers. Questions need at least 5 characters and answers at least 2 characters. Remove a question to stop advertising it as an FAQ.</p>
  </div>;
}
