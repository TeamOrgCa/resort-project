import { NextResponse } from "next/server";
import { requireAdminStaff, createAuditLog } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentImageExtension, CONTENT_IMAGE_BUCKET, CONTENT_IMAGE_MAX_BYTES } from "@/lib/settings/content-images";

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > CONTENT_IMAGE_MAX_BYTES) {
      return NextResponse.json({ success: false, message: "Choose a PNG, JPEG, or WebP image up to 5 MB." }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const extension = contentImageExtension(bytes, file.type);
    if (!extension) return NextResponse.json({ success: false, message: "Choose a valid PNG, JPEG, or WebP image." }, { status: 400 });
    const client = createAdminClient();
    const path = `${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from(CONTENT_IMAGE_BUCKET).upload(path, bytes,
      { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (error) return NextResponse.json({ success: false, message: "Unable to upload image. Check that the site-content storage bucket is configured." }, { status: 500 });
    const { data } = client.storage.from(CONTENT_IMAGE_BUCKET).getPublicUrl(path);
    await createAuditLog(staff, { action: "Uploaded website content image", entityType: "business_settings", details: { path } });
    return NextResponse.json({ success: true, url: data.publicUrl });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to upload image." }, { status: 500 });
  }
}
