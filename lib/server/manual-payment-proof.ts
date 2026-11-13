import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";

/** Validate an owned, decodable image without attempting to interpret a provider's receipt. */
export async function inspectManualPaymentProof(client: SupabaseClient, userId: string, proofPath: string): Promise<boolean> {
  if (!proofPath.startsWith(`${userId}/`) || proofPath.includes("..") || !/\.(png|jpe?g|webp)$/i.test(proofPath)) return false;
  const { data, error } = await client.storage.from(PAYMENT_PROOF_BUCKET).download(proofPath);
  if (error || !data || data.size < 1 || data.size > MAX_PAYMENT_PROOF_BYTES) return false;
  try {
    const image = sharp(Buffer.from(await data.arrayBuffer()), { limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || !metadata.width || !metadata.height) return false;
    await image.resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).toBuffer();
    return true;
  } catch { return false; }
}
