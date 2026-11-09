import sharp from "sharp";
import type { Page, Worker } from "tesseract.js";
import { gcashNumericLines, inspectReceiptReadability } from "@/lib/server/receipt-image-quality";

type ReceiptPage = Pick<Page, "text" | "confidence" | "blocks">;

/** Retry uncertain transaction lines using only their original pixels. No form or
 * account values enter OCR, and enlarging cannot waive the native text-size check. */
export async function retryGcashNumericLines(bytes: Buffer, page: ReceiptPage, worker: Pick<Worker, "recognize">): Promise<ReceiptPage> {
  // GCash places the reference and timestamp in separate footer columns. A
  // wide SINGLE_LINE crop can repeatedly misread the date beside the reference.
  // Separate only a geometrically distinct, labelled reference/date pair.
  page = { ...page, blocks: page.blocks?.map(block => ({ ...block, paragraphs: block.paragraphs.map(paragraph => ({ ...paragraph,
    lines: paragraph.lines.flatMap(line => {
      if (!/^ref(?:erence)?\b/i.test(line.text.trim())) return [line];
      const words = line.words;
      const split = words.findIndex((word, index) => index > 0
        && word.bbox.x0 - words[index - 1].bbox.x1 > (line.bbox.y1 - line.bbox.y0) * 2
        && /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(word.text));
      if (split < 0) return [line];
      return [words.slice(0, split), words.slice(split)].map(segment => ({ ...line,
        text: segment.map(word => word.text).join(" "), words: segment,
        bbox: { x0: Math.min(...segment.map(word => word.bbox.x0)), x1: Math.max(...segment.map(word => word.bbox.x1)),
          y0: Math.min(...segment.map(word => word.bbox.y0)), y1: Math.max(...segment.map(word => word.bbox.y1)) },
      }));
    }),
  })) })) ?? null };
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
    // Centered footers place a grouped reference above the timestamp. If the
    // label and digit spacing confuse whole-line recognition, retry just the
    // numeric words at their detected position, without using entered values.
    const label = line.text.trim().match(/^(?:ref(?:erence)?\.?\s*(?:no\.?|number)?)\s*[:#-]?\s*/i)?.[0];
    const digitWords = line.words.filter(word => /^\d[\d\s-]*$/.test(word.text.trim()));
    const referenceOnly = label && /^[\d\s-]+$/.test(line.text.trim().slice(label.length))
      && digitWords.map(word => word.text).join("").replace(/\D/g, "").length >= 8;
    const regions = [{ left, top, width, height, digitsOnly: false }];
    if (referenceOnly && digitWords.length && digitWords.length < line.words.length) {
      const x0 = Math.max(0, Math.floor(Math.min(...digitWords.map(word => word.bbox.x0))) - 8);
      const y0 = Math.max(0, Math.floor(Math.min(...digitWords.map(word => word.bbox.y0))) - 8);
      regions.push({ left: x0, top: y0,
        width: Math.min((metadata.width ?? 0) - x0, Math.ceil(Math.max(...digitWords.map(word => word.bbox.x1))) - x0 + 8),
        height: Math.min((metadata.height ?? 0) - y0, Math.ceil(Math.max(...digitWords.map(word => word.bbox.y1))) - y0 + 8),
        digitsOnly: true });
    }
    // All retries retain the same confidence and native-size limits.
    retryRegions: for (const region of regions) {
      if (region.width < 20 || region.width > 2000 || region.height < 12 || region.height > 180) continue;
      const source = sharp(bytes).extract({ left: region.left, top: region.top, width: region.width, height: region.height }).grayscale().normalise();
      for (const scale of [2, 3]) {
        const crop = await source.clone().resize({ width: region.width * scale }).png().toBuffer();
        const retry = (await worker.recognize(crop, {}, { text: true, blocks: true })).data;
        if (!inspectReceiptReadability(retry, { nativeScale: scale }).accepted) continue;
        const retryLines = (retry.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
        if (retryLines.length !== 1 || !line.text.trim() || !retry.text.trim()) continue;
        if (region.digitsOnly && !/^\d[\d\s-]*\d$/.test(retry.text.trim())) continue;
        const referenceLength = retry.text.replace(/\D/g, "").length;
        if (region.digitsOnly && (referenceLength < 8 || referenceLength > 20)) continue;
        const replacement = retryLines[0];
        const replacementText = region.digitsOnly ? `${label}${retry.text.trim()}` : retry.text.trim();
        // Keep coordinates in the original screenshot for subsequent field/mask checks.
        replacements.set(line, { ...line, text: replacementText, words: replacement.words.map(word => ({ ...word, bbox: {
          x0: region.left + word.bbox.x0 / scale, x1: region.left + word.bbox.x1 / scale,
          y0: region.top + word.bbox.y0 / scale, y1: region.top + word.bbox.y1 / scale,
        } })) });
        text = text.replace(line.text.trim(), replacementText);
        break retryRegions;
      }
    }
  }
  return { ...page, text, blocks: page.blocks?.map(block => ({ ...block, paragraphs: block.paragraphs.map(paragraph => ({ ...paragraph,
    lines: paragraph.lines.map(line => replacements.get(line) ?? line),
  })) })) ?? null };
}
