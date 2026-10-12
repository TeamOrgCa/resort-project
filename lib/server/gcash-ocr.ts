import type { SupabaseClient } from "@supabase/supabase-js";
import { join } from "node:path";
import { MAX_PAYMENT_PROOF_BYTES, PAYMENT_PROOF_BUCKET } from "@/lib/booking/payment-proof";
import { assessGcashText, screenReceiptText, isGcashMethod, type OcrAssessment } from "@/lib/booking/gcash-receipt";
import { inspectReceiptImage, inspectReceiptReadability } from "@/lib/server/receipt-image-quality";

export type ProofInspection = OcrAssessment | { status: "rejected" | "screening_unavailable"; notes: string };

export async function inspectPaymentProof(
  supabase: SupabaseClient,
  input: {
    userId: string;
    proofPath: string;
    methodName: string;
    methodType: string;
    amount: number;
    minimumAmount: number;
    reference: string;
    recipientName?: string | null;
    recipientNumber?: string | null;
  },
): Promise<ProofInspection | null> {
  if (!input.proofPath.startsWith(`${input.userId}/`) || input.proofPath.includes("..")) {
    return null;
  }
  if (!/\.(png|jpe?g|webp)$/i.test(input.proofPath)) {
    return null;
  }

  const { data: image, error } = await supabase.storage.from(PAYMENT_PROOF_BUCKET).download(input.proofPath);
  if (error || !image || image.size === 0 || image.size > MAX_PAYMENT_PROOF_BYTES) return null;
  const isGcash = isGcashMethod({ name: input.methodName, type: input.methodType });
  try {
    const bytes = Buffer.from(await image.arrayBuffer());
    if (isGcash) {
      const quality = await inspectReceiptImage(bytes);
      if (!quality.accepted) return { status: "rejected", notes: quality.reason };
    }
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      // Next bundles Tesseract's default __dirname as C:\ROOT; workers need a real file path.
      workerPath: join(process.cwd(), "node_modules", "tesseract.js", "src", "worker-script", "node", "index.js"),
      langPath: join(process.cwd(), "assets", "ocr"),
      gzip: false,
      cacheMethod: "none",
    });
    const result = await worker.recognize(bytes, {}, { text: true, blocks: true }).finally(() => worker.terminate());
    if (isGcash) {
      const readability = inspectReceiptReadability(result.data);
      if (!readability.accepted) return { status: "rejected", notes: readability.reason };
    }
    const screen = screenReceiptText(result.data.text, isGcash);
    if (!screen.plausible) return { status: "rejected", notes: screen.reason ?? "The uploaded image is not a payment receipt." };
    return isGcash
      ? assessGcashText(result.data.text, input)
      : { status: "not_applicable", notes: "The image has payment details. Cashier must reconcile the transaction in the receiving account." };
  } catch (error) {
    console.error("[payment proof] OCR screening failed", error);
    return { status: "screening_unavailable", notes: "Receipt screening is temporarily unavailable. Please try again later." };
  }
}
