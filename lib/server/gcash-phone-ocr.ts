import sharp from "sharp";
import type { Page } from "tesseract.js";

/** Read visible phone digits separately from circular privacy masks, without guessing digits. */
export async function maskedGcashPhoneCrop(bytes: Buffer, page: Pick<Page, "text" | "blocks">): Promise<{ prefix: Buffer; suffix: Buffer; maskCount: number; originalLine: string } | null> {
  if (!/^sent\s+via\s+g\s*cash\s*$/im.test(page.text)) return null;
  const lines = (page.blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines));
  const amountY = Math.min(...lines.filter(line => /^amount\b/i.test(line.text.trim())).map(line => line.bbox.y0));
  const candidates = lines.filter(line => /^\s*\+?63\s/.test(line.text) && line.bbox.y1 < amountY);
  if (candidates.length !== 1) return null;
  const line = candidates[0];
  const decoder = sharp(bytes, { limitInputPixels: 20_000_000 });
  const metadata = await decoder.metadata();
  const left = Math.max(0, line.bbox.x0 - 8), top = Math.max(0, line.bbox.y0 - 8);
  const width = Math.min((metadata.width ?? 0) - left, line.bbox.x1 - left + 8);
  const height = Math.min((metadata.height ?? 0) - top, line.bbox.y1 - top + 8);
  const lineHeight = line.bbox.y1 - line.bbox.y0;
  if (width < 100 || width > 2000 || lineHeight < 12 || height > 200) return null;
  const { data, info } = await decoder.extract({ left, top, width, height }).removeAlpha().grayscale().threshold(180).raw().toBuffer({ resolveWithObject: true });
  const seen = new Uint8Array(info.width * info.height);
  const circles: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const start = y * info.width + x;
    if (seen[start] || data[start] > 128) continue;
    seen[start] = 1;
    const stack = [start];
    let count = 0, x0 = x, x1 = x, y0 = y, y1 = y;
    while (stack.length) {
      const point = stack.pop()!, px = point % info.width, py = Math.floor(point / info.width);
      count++; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = px + dx, ny = py + dy, next = ny * info.width + nx;
        if (nx < 0 || nx >= info.width || ny < 0 || ny >= info.height || seen[next] || data[next] > 128) continue;
        seen[next] = 1; stack.push(next);
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const center = ((y0 + y1) / 2 - (line.bbox.y0 - top)) / lineHeight;
    if (h >= 4 && h < lineHeight * .65 && w / h > .7 && w / h < 1.4 && count / (w * h) > .65 && center > .25 && center < .75) circles.push({ x0, x1, y0, y1 });
  }
  if (circles.length < 2) return null;
  const firstMask = Math.min(...circles.map(c => c.x0)), lastMask = Math.max(...circles.map(c => c.x1));
  // Do not discard any visible digit between two mask groups.
  for (let y = 0; y < info.height; y++) for (let x = firstMask; x <= lastMask; x++) {
    if (data[y * info.width + x] <= 128 && !circles.some(c => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1)) return null;
  }
  if (firstMask < 10 || info.width - lastMask < 10) return null;
  const segment = (x: number, w: number) => sharp(bytes).extract({ left: left + x, top, width: w, height })
    .resize({ width: Math.min(w * 3, 1800) }).png().toBuffer();
  return { originalLine: line.text.trim(), prefix: await segment(0, firstMask), suffix: await segment(lastMask + 1, info.width - lastMask - 1), maskCount: circles.length };
}
