import { containsEmoji, containsEmojiText } from "@/lib/validation/emoji";

export async function requestHasEmojiText(request: Request): Promise<boolean> {
  const url = new URL(request.url);
  if ([...url.searchParams.values()].some(containsEmoji)) return true;
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  try {
    // Never consume or rewrite the body needed by the route handler. Uploaded image
    // contents and filenames are not text fields and must not be decoded as text.
    if (!type || type === "text/plain" || type === "application/json" || type.endsWith("+json")) return containsEmojiText(await request.clone().json());
    if (type === "multipart/form-data" || type === "application/x-www-form-urlencoded") {
      const form = await request.clone().formData();
      return [...form.values()].some(value => typeof value === "string" && containsEmoji(value));
    }
  } catch { /* Each route retains its existing malformed-payload validation. */ }
  return false;
}
