"use client";

import Image from "next/image";
import { useState } from "react";
import { CONTENT_IMAGE_MAX_BYTES } from "@/lib/settings/content-images";
import { isContentImageUrl } from "@/lib/settings/public-content";

export default function ContentImageEditor({ value, onChange, label, onUploadingChange }: { value: string; onChange: (value: string) => void; label: string; onUploadingChange?: (uploading: boolean) => void }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setError(null);
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > CONTENT_IMAGE_MAX_BYTES) {
      setError("Choose a PNG, JPEG, or WebP image up to 5 MB."); return;
    }
    setUploading(true);
    onUploadingChange?.(true);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/admin/settings/images", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok || !payload.success || !payload.url) throw new Error(payload.message ?? "Unable to upload image.");
      onChange(payload.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to upload image."); }
    finally { setUploading(false); onUploadingChange?.(false); }
  };
  return <div className="mt-3 space-y-3">
    {isContentImageUrl(value) && <div className="relative h-40 w-full max-w-sm overflow-hidden rounded-lg border bg-base"><Image src={value} alt={`${label} preview`} fill unoptimized className="object-contain" /></div>}
    <label className="block text-sm">Image URL or local image path
      <input aria-label={`${label} URL`} value={value} disabled={uploading} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral/20 px-3 py-2" placeholder="https://... or /image.jpg" />
    </label>
    <label className="block text-sm">Upload image (PNG, JPEG, WebP; up to 5 MB)
      <input aria-label={`Upload ${label}`} type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} className="mt-1 block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-base file:px-4 file:py-2" />
    </label>
    {uploading && <p role="status" className="text-sm">Uploading image...</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="text-xs text-neutral/60">Save this section after uploading to publish the image.</p>
  </div>;
}
