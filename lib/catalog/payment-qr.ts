import type { SupabaseClient } from "@supabase/supabase-js";
import { contentImageExtension, CONTENT_IMAGE_MAX_BYTES } from "@/lib/settings/content-images";
import { CatalogValidationError } from "./validation";

export const PAYMENT_QR_BUCKET = "payment-qr-codes";
export class PaymentQrStorageError extends Error {}

export async function uploadPaymentQr(client: SupabaseClient, accountId: string, file: File) {
  if (!file.size || file.size > CONTENT_IMAGE_MAX_BYTES) throw new CatalogValidationError("Choose a PNG, JPEG, or WebP QR image up to 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const extension = contentImageExtension(bytes, file.type);
  if (!extension) throw new CatalogValidationError("Choose a valid PNG, JPEG, or WebP QR image.");
  const path = `${accountId}/${crypto.randomUUID()}.${extension}`;
  const storage = client.storage.from(PAYMENT_QR_BUCKET);
  const options = { contentType: file.type, cacheControl: "3600", upsert: false };
  let result = await storage.upload(path, bytes, options);
  // Older deployments may have the table without the private QR bucket.
  if (result.error && /bucket.*not found/i.test(result.error.message)) {
    const created = await client.storage.createBucket(PAYMENT_QR_BUCKET, {
      public: false, fileSizeLimit: CONTENT_IMAGE_MAX_BYTES,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    });
    if (!created.error || /already exists|duplicate/i.test(created.error.message)) result = await storage.upload(path, bytes, options);
    else throw new PaymentQrStorageError("QR storage could not be initialized. Check the server's Supabase service role configuration.");
  }
  if (result.error) throw new PaymentQrStorageError("Unable to upload the QR image. Check QR storage availability and try again.");
  return path;
}

export async function readCatalogSave(request: Request) {
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await request.formData();
    const payload = form.get("payload");
    const file = form.get("file");
    return { body: typeof payload === "string" ? JSON.parse(payload) as Record<string, unknown> : null, file: file instanceof File ? file : null };
  }
  return { body: await request.json().catch(() => null) as Record<string, unknown> | null, file: null };
}
