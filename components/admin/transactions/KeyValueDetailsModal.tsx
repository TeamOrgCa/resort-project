"use client";

import type { ViewDetailsState } from "./types";

interface KeyValueDetailsModalProps {
  details: ViewDetailsState;
  onClose: () => void;
}

export default function KeyValueDetailsModal({ details, onClose }: KeyValueDetailsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-neutral/40 px-4 py-6 sm:items-center" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-neutral/10 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-neutral">{details.title}</h3>
            <p className="mt-1 text-sm text-neutral/70">Detailed record view for this billing entry.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral/20 px-3 py-1.5 text-xs font-medium text-neutral hover:bg-base"
          >
            Close
          </button>
        </div>

        <div className="mt-5 grid gap-2 text-sm text-neutral/80 sm:grid-cols-2">
          {details.fields.map((field) => (
            <p key={field.label}>
              {field.label}: <span className="font-semibold text-neutral">{field.value || "-"}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}