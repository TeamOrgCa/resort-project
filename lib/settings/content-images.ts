export const CONTENT_IMAGE_BUCKET = "site-content";
export const CONTENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export function contentImageExtension(bytes: Uint8Array, mime: string): string | null {
  if (mime === "image/png" && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "png";
  if (mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (mime === "image/webp" && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "webp";
  return null;
}
