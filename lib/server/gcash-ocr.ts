import type { SupabaseClient } from "@supabase/supabase-js";
import { join } from "node:path";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";
import { assessGcashText, type OcrAssessment } from "@/lib/booking/gcash-receipt";
export async function inspectGcashProof(
  supabase: SupabaseClient,
  input: {
    userId: string;
    proofPath: string;
    methodName: string;
    methodType: string;
    amount: number;
    reference: string;
    recipientName?: string | null;
    recipientNumber?: string | null;
  },
): Promise<OcrAssessment | null> {
  if (!input.proofPath.startsWith(`${input.userId}/`) || input.proofPath.includes("..")) {
    return null;
  }
  if (!/\.(png|jpe?g|webp)$/i.test(input.proofPath)) {
    return null;
  }

  const { data: image, error } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).download(input.proofPath);
  if (error || !image || image.size === 0 || image.size > MAX_PAYMENT_PROOF_BYTES) return null;
  if (!/gcash/i.test(`${input.methodName} ${input.methodType}`)) {
    return { status: "not_applicable", notes: "GCash OCR does not apply to this payment method." };
  }

  try {
    const { recognize } = await import("tesseract.js");
    const result = await recognize(Buffer.from(await image.arrayBuffer()), "eng", {
      langPath: join(process.cwd(), "assets", "ocr"),
      gzip: false,
      cacheMethod: "none",
    });
    return assessGcashText(result.data.text, input);
  } catch {
    return { status: "unreadable", notes: "OCR could not read this receipt. Cashier review is required." };
  }
}
