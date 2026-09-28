import { NextResponse } from "next/server";
import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";

const bucketName = "payment-qr-codes";

export async function POST(request: Request) {
  const staffContext = await requireAdminStaff();
  if (!staffContext) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });

  const formData = await request.formData();
  const file = formData.get("file");
  const accountId = formData.get("accountId");

  if (!(file instanceof File) || typeof accountId !== "string" || !accountId.trim()) {
    return NextResponse.json({ success: false, message: "A QR image and payment account are required." }, { status: 400 });
  }

  if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ success: false, message: "QR code must be an image up to 5 MB." }, { status: 400 });
  }

  try {
    const adminClient = createAdminClient();
    const { data: account, error: accountError } = await adminClient
      .from("payment_accounts")
      .select("account_id")
      .eq("account_id", accountId.trim())
      .maybeSingle();
    if (accountError || !account) return NextResponse.json({ success: false, message: "Payment account not found." }, { status: 404 });

    const extension = file.name.split(".").pop()?.toLowerCase() || "png";
    const path = `${accountId.trim()}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await adminClient.storage.from(bucketName).upload(path, file, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });

    if (uploadError) return NextResponse.json({ success: false, message: uploadError.message }, { status: 400 });

    const { error: updateError } = await adminClient
      .from("payment_accounts")
      .update({ qr_image: path })
      .eq("account_id", accountId.trim());

    if (updateError) return NextResponse.json({ success: false, message: updateError.message }, { status: 400 });
    await createAuditLog(staffContext, { action: "Uploaded payment account QR code", entityType: "payment_account", entityId: accountId.trim() });
    return NextResponse.json({ success: true, path });
  } catch {
    return NextResponse.json({ success: false, message: "Unable to upload QR code." }, { status: 500 });
  }
}