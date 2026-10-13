import sharp from "sharp";
import type { Page, Worker } from "tesseract.js";
import { gcashNumericLines, inspectReceiptReadability } from "@/lib/server/receipt-image-quality";

type ReceiptPage = Pick<Page, "text" | "confidence" | "blocks">;

/** Retry uncertain transaction lines using only their original pixels. No form or
 * account values enter OCR, and enlarging cannot waive the native text-size check. */
export async function retryGcashNumericLines(bytes: Buffer, page: ReceiptPage, worker: Pick<Worker, "recognize">): Promise<ReceiptPage> {
  const candidates = gcashNumericLines(page).filter(line => line.words.some(word => /\d/.test(word.text) && (!Number.isFinite(word.confidence) || word.confidence < 80)));
  if (!candidates.length || candidates.length > 6 || !Number.isFinite(page.confidence) || page.confidence < 75) return page;
  const metadata = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
  const replacements = new Map<(typeof candidates)[number], (typeof candidates)[number]>();
  let text = page.text;
  for (const line of candidates) {
    if (line.words.some(word => /\d/.test(word.text) && word.bbox.y1 - word.bbox.y0 < 12)) continue;
    const left = Math.max(0, Math.floor(line.bbox.x0) - 8), top = Math.max(0, Math.floor(line.bbox.y0) - 8);
    const width = Math.min((metadata.width ?? 0) - left, Math.ceil(line.bbox.x1) - left + 8);
    const height = Math.min((metadata.height ?? 0) - top, Math.ceil(line.bbox.y1) - top + 8);
    if (![left, top, width, height].every(Number.isFinite) || width < 20 || width > 2000 || height < 12 || height > 180) continue;
    const crop = await sharp(bytes).extract({ left, top, width, height }).grayscale().normalise().resize({ width: width * 2 }).png().toBuffer();
    const retry = (await worker.recognize(crop, {}, { text: true, blocks: true })).data;
    if (!inspectReceiptReadability(retry, { nativeScale: 2 }).accepted) continue;
    const retryLines = (retry.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
    if (retryLines.length !== 1 || !line.text.trim() || !retry.text.trim()) continue;
    const replacement = retryLines[0];
    // Keep coordinates in the original screenshot for subsequent field/mask checks.
    replacements.set(line, { ...line, text: retry.text.trim(), words: replacement.words.map(word => ({ ...word, bbox: {
      x0: left + word.bbox.x0 / 2, x1: left + word.bbox.x1 / 2,
      y0: top + word.bbox.y0 / 2, y1: top + word.bbox.y1 / 2,
    } })) });
    text = text.replace(line.text.trim(), retry.text.trim());
  }
  return { ...page, text, blocks: page.blocks?.map(block => ({ ...block, paragraphs: block.paragraphs.map(paragraph => ({ ...paragraph,
    lines: paragraph.lines.map(line => replacements.get(line) ?? line),
  })) })) ?? null };
}
