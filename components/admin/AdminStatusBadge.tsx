const tones = {
  positive: "border-emerald-200 bg-emerald-50 text-emerald-800",
  pending: "border-amber-200 bg-amber-50 text-amber-800",
  negative: "border-red-200 bg-red-50 text-red-800",
  information: "border-violet-200 bg-violet-50 text-violet-800",
  neutral: "border-neutral/10 bg-neutral/5 text-neutral/65",
};

export default function AdminStatusBadge({ status }: { status: string }) {
  const normalized = status.toLowerCase().replaceAll("_", " ").trim();
  const tone = /^(active|verified|confirmed|paid|approved|completed|checked in|success)$/.test(normalized) ? "positive"
    : /^(pending|partial|partially paid|unpaid|payment submitted|pending refund|reviewed|awaiting.*)$/.test(normalized) ? "pending"
    : /^(rejected|failed|error|cancelled|canceled)$/.test(normalized) ? "negative"
    : /^(refunded|payout submitted|rescheduled)$/.test(normalized) ? "information" : "neutral";
  return <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />{status}</span>;
}
