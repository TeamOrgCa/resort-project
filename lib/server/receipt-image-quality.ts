import sharp from "sharp";
import type { Page } from "tesseract.js";

const SCREENSHOT_HELP = "Upload the original, clear screenshot taken directly in GCash. Photos of another phone, scans, blurred images and edited receipts are not accepted.";
export type ImageQuality = { accepted: true } | { accepted: false; reason: string };
const reject = (reason: string): ImageQuality => ({ accepted: false, reason: `${reason} ${SCREENSHOT_HELP}` });

/** Read camera-specific TIFF/EXIF tags, rather than rejecting ordinary screenshot metadata. */
export function hasCameraExif(exif?: Buffer): boolean {
  if (!exif?.length) return false;
  const start = exif.subarray(0, 6).equals(Buffer.from("Exif\0\0")) ? 6 : 0;
  const tiff = exif.subarray(start);
  const order = tiff.subarray(0, 2).toString("ascii");
  if (tiff.length < 8 || (order !== "II" && order !== "MM")) return false;
  const read16 = (offset: number) => order === "II" ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset);
  const read32 = (offset: number) => order === "II" ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset);
  if (read16(2) !== 42) return false;
  const cameraTags = new Set([0x010f, 0x0110, 0x829a, 0x829d, 0x8827, 0x9201, 0x920a, 0xa433, 0xa434]);
  const visited = new Set<number>();
  const scan = (offset: number): boolean => {
    if (visited.has(offset) || visited.size >= 4 || offset < 8 || offset + 2 > tiff.length) return false;
    visited.add(offset);
    const count = read16(offset);
    if (count > 512 || offset + 2 + count * 12 > tiff.length) return false;
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12, tag = read16(entry);
      if (cameraTags.has(tag) && read32(entry + 4) > 0) return true;
      if (tag === 0x8769 && scan(read32(entry + 8))) return true;
    }
    return false;
  };
  return scan(read32(4));
}

/** Best-effort screen/photo discrimination. Absence of EXIF never proves provenance. */
export async function inspectReceiptImage(bytes: Buffer): Promise<ImageQuality> {
  try {
    const decoder = sharp(bytes, { limitInputPixels: 20_000_000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) return reject("Use a single PNG, JPEG or WebP screenshot.");
    if (hasCameraExif(metadata.exif)) return reject("This file contains camera-capture details.");
    const width = metadata.width ?? 0, height = metadata.height ?? 0;
    if (Math.min(width, height) < 320 || Math.max(width, height) < 480) return reject("The receipt image is too small to read reliably.");
    // Sample native pixels, without resizing away camera noise or upscaling tiny text.
    const { data, info } = await decoder.removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
    let flat = 0, sampled = 0;
    for (let row = 0; row < 24; row++) for (let column = 0; column < 16; column++) {
      const x = Math.floor(info.width * (0.08 + 0.84 * (column + 0.5) / 16));
      const y = Math.floor(info.height * (0.08 + 0.84 * (row + 0.5) / 24));
      const low = [255, 255, 255], high = [0, 0, 0];
      for (let dy = -6; dy < 6; dy++) for (let dx = -6; dx < 6; dx++) {
        const offset = ((y + dy) * info.width + x + dx) * info.channels;
        for (let channel = 0; channel < 3; channel++) {
          low[channel] = Math.min(low[channel], data[offset + channel]);
          high[channel] = Math.max(high[channel], data[offset + channel]);
        }
      }
      if (high.every((value, channel) => value - low[channel] <= 12)) flat++;
      sampled++;
    }
    if (flat / sampled < 0.45) return reject("This image has photo-like texture or heavy compression.");
    return { accepted: true };
  } catch { return reject("The receipt image is invalid, damaged or too large to process."); }
}

export function inspectReceiptReadability(page: Pick<Page, "confidence" | "blocks">): ImageQuality {
  if (!Number.isFinite(page.confidence) || page.confidence < 75) return reject("The receipt text is not clear enough to read reliably.");
  const lines = (page.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
  const numericWords = lines.flatMap((line) => line.words).filter((word) => /\d/.test(word.text));
  if (!numericWords.length || numericWords.some((word) => !Number.isFinite(word.confidence) || word.confidence < 80 || word.bbox.y1 - word.bbox.y0 < 12)) {
    return reject("The receipt numbers are blurred, too small or unclear.");
  }
  const tilted = lines.filter((line) => {
    const width = line.baseline.x1 - line.baseline.x0;
    return width >= 150 && Math.abs((line.baseline.y1 - line.baseline.y0) / width) > 0.025;
  });
  if (tilted.length >= 2) return reject("The receipt text is tilted like a photographed screen.");
  return { accepted: true };
}
