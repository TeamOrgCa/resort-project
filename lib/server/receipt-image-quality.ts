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

type ReceiptPage = Pick<Page, "confidence" | "blocks">;

/** Decorative carbon statistics are not transaction numbers. Missing fields are
 * still rejected by assessGcashText; every detected payment field stays checked. */
export function gcashNumericLines(page: ReceiptPage) {
  const lines = (page.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
  const selected = new Set<(typeof lines)[number]>();
  const field = /^(?:amount(?:\s+(?:sent|paid))?|payment amount|you sent|reference(?:\s*(?:number|no\.?))?|ref\.?\s*(?:number|no\.?)?|transaction\s*(?:id|number|no\.?)|date|time)\b/i;
  const date = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s*\d|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{1,2}:\d{2}/i;
  const phone = /(?:\+?63|0)\s*[\d*xX•●·∙⋅.…][\d*xX•●·∙⋅.…\s-]{7,24}/;
  for (let i = 0; i < lines.length; i++) {
    const text = (lines[i].text ?? lines[i].words.map(word => word.text).join(" ")).trim();
    if (/^total\b/i.test(text)) continue; // Fee-inclusive total is not the sent amount.
    if (field.test(text) || date.test(text) || phone.test(text)) selected.add(lines[i]);
    if (field.test(text) && !/\d/.test(text) && lines[i + 1]) selected.add(lines[i + 1]);
  }
  return [...selected];
}

export function inspectReceiptReadability(page: ReceiptPage, options: { gcash?: boolean; nativeScale?: number } = {}): ImageQuality {
  if (!Number.isFinite(page.confidence) || page.confidence < 75) return reject("The receipt text is not clear enough to read reliably.");
  const lines = (page.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines));
  const numericWords = (options.gcash ? gcashNumericLines(page) : lines).flatMap((line) => line.words).filter((word) => /\d/.test(word.text));
  const scale = options.nativeScale ?? 1;
  if (!Number.isFinite(scale) || scale < 1 || !numericWords.length || numericWords.some((word) => !Number.isFinite(word.confidence) || word.confidence < 80 || (word.bbox.y1 - word.bbox.y0) / scale < 12)) {
    return reject("The receipt numbers are blurred, too small or unclear.");
  }
  const tilted = lines.filter((line) => {
    const width = line.baseline.x1 - line.baseline.x0;
    return width >= 150 && Math.abs((line.baseline.y1 - line.baseline.y0) / width) > 0.025;
  });
  if (tilted.length >= 2) return reject("The receipt text is tilted like a photographed screen.");
  return { accepted: true };
}

/** This Send Money layout uses a white check on blue instead of written success text. */
export async function hasGcashSuccessCheck(bytes: Buffer): Promise<boolean> {
  const decoder = sharp(bytes, { limitInputPixels: 20_000_000 });
  const metadata = await decoder.metadata();
  const sourceWidth = metadata.width ?? 0, sourceHeight = metadata.height ?? 0;
  if (!sourceWidth || !sourceHeight) return false;
  // Limit work to the header and reduce pixels only for this symbol check. Image/text
  // readability still use the original resolution, so upscaling never hides blur.
  const { data, info } = await decoder.extract({ left: 0, top: 0, width: sourceWidth, height: Math.max(1, Math.floor(Math.min(sourceHeight * .45, sourceWidth * 1.2))) })
    .resize({ width: 640, withoutEnlargement: true }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const width = info.width, height = info.height;
  const white = (x: number, y: number) => {
    const i = (y * width + x) * info.channels;
    return data[i] >= 225 && data[i + 1] >= 225 && data[i + 2] >= 225;
  };
  const blue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= info.height) return false;
    const i = (y * width + x) * info.channels;
    return data[i + 2] > 110 && data[i + 2] - data[i] > 60 && data[i + 2] - data[i + 1] > 25;
  };
  const seen = new Uint8Array(width * height);
  for (let y = 1; y < height - 1; y++) for (let x = Math.floor(width * .3); x < width * .7; x++) {
    const offset = y * width + x;
    if (seen[offset] || !white(x, y)) continue;
    const stack = [offset], pixels: number[] = [];
    seen[offset] = 1;
    let x0 = x, x1 = x, y0 = y, y1 = y;
    while (stack.length) {
      const point = stack.pop()!;
      const px = point % width, py = Math.floor(point / width);
      pixels.push(point); x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = px + dx, ny = py + dy, next = ny * width + nx;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height || seen[next] || !white(nx, ny)) continue;
        seen[next] = 1; stack.push(next);
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1, density = pixels.length / (w * h);
    if (w < 12 || h < 10 || w > width * .15 || h / w < .3 || h / w > .85 || density < .08 || density > .55) continue;
    // Check the asymmetric down-then-up stroke, rejecting rings, crosses and plain V's.
    const mean = (low: number, high: number) => {
      const region = pixels.filter(point => (point % width - x0) / w >= low && (point % width - x0) / w < high);
      return region.length ? region.reduce((sum, point) => sum + Math.floor(point / width), 0) / region.length : NaN;
    };
    const left = mean(0, .2), bend = mean(.35, .55), right = mean(.8, 1);
    if (!(bend > left + h * .12 && bend > right + h * .3 && left > right + h * .12)) continue;
    const padding = Math.max(2, Math.floor(w * .1));
    if ([ [x0 - padding, y0 - padding], [x1 + padding, y0 - padding], [x0 - padding, y1 + padding], [x1 + padding, y1 + padding] ].every(([px, py]) => blue(px, py))) return true;
  }
  return false;
}
