import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { isContentImageUrl, publicContentDefaults } from "@/lib/settings/public-content";
import { CONTENT_IMAGE_BUCKET, CONTENT_IMAGE_MAX_BYTES } from "@/lib/settings/content-images";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";

/** Read the same logo as the website at send time, so configuration edits apply
 * to the next email. Email clients require absolute public image URLs. */
async function getConfiguredLogo(): Promise<string | null> {
  try {
    const admin = tryCreateAdminClient();
    if (!admin) return null;
    const { data, error } = await admin.from("business_settings")
      .select("setting_value").eq("setting_key", "content.branding.logo")
      .abortSignal(AbortSignal.timeout(3000)).maybeSingle();
    if (error) return null;
    const logo = data?.setting_value ?? publicContentDefaults["content.branding.logo"];
    if (!isContentImageUrl(logo)) return null;
    return logo;
  } catch {
    // Branding availability must never prevent transactional mail delivery.
    return null;
  }
}

function publicLogoUrl(logo: string): string | null {
  if (!logo.startsWith("/")) return logo;
  try {
    if (!process.env.NEXT_PUBLIC_SITE_URL) return null;
    const url = new URL(logo, process.env.NEXT_PUBLIC_SITE_URL);
    return isContentImageUrl(url.href) ? url.href : null;
  } catch { return null; }
}

export async function getEmailLogoUrl(): Promise<string | null> {
  const logo = await getConfiguredLogo();
  return logo ? publicLogoUrl(logo) : null;
}

export type EmailBranding = {
  logoUrl: string | null;
  attachments: { filename: string; content: Buffer; contentType: string; contentDisposition: "inline"; cid: string }[];
};

/** Embed normal Configuration uploads and bundled website assets as CID images.
 * This works without a public website origin or remote-image loading in the inbox.
 * Arbitrary external HTTPS logos remain remote links, rather than server fetches. */
export async function getEmailBranding(): Promise<EmailBranding> {
  const logo = await getConfiguredLogo() ?? String(publicContentDefaults["content.branding.logo"]);
  const fallback: EmailBranding = { logoUrl: publicLogoUrl(logo), attachments: [] };
  try {
    let bytes: Buffer | undefined;
    if (logo.startsWith("/")) {
      const root = resolve(process.cwd(), "public");
      const path = resolve(root, decodeURIComponent(logo.split(/[?#]/)[0]).replace(/^\/+/, ""));
      if (!path.startsWith(`${root}${sep}`)) return { logoUrl: null, attachments: [] };
      bytes = await readFile(path);
    } else if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
      const url = new URL(logo), origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
      const prefix = `/storage/v1/object/public/${CONTENT_IMAGE_BUCKET}/`;
      if (url.origin === origin.origin && url.pathname.startsWith(prefix)) {
        const path = decodeURIComponent(url.pathname.slice(prefix.length));
        const admin = tryCreateAdminClient();
        if (!admin || !path || path.split("/").includes("..")) return fallback;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([
            admin.storage.from(CONTENT_IMAGE_BUCKET).download(path),
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Logo download timed out")), 3000); }),
          ]);
          if (result.error || !result.data || result.data.size > CONTENT_IMAGE_MAX_BYTES) return fallback;
          bytes = Buffer.from(await result.data.arrayBuffer());
        } finally { if (timer) clearTimeout(timer); }
      }
    }
    if (!bytes?.length || bytes.length > CONTENT_IMAGE_MAX_BYTES) return fallback;
    const image = sharp(bytes, { limitInputPixels: 20_000_000 });
    const metadata = await image.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) return fallback;
    const content = await image.trim().resize({ width: 360, height: 200, fit: "inside", withoutEnlargement: true }).png().toBuffer();
    const cid = "marville-website-logo@resort";
    return { logoUrl: `cid:${cid}`, attachments: [{ filename: "marville-logo.png", content, contentType: "image/png", contentDisposition: "inline", cid }] };
  } catch { return fallback; }
}
