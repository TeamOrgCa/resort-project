import { NextResponse } from "next/server";
import { createAuditLog, requireAdminStaff } from "@/lib/server/admin-audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCatalogUuid } from "@/lib/catalog/catalog";
import { PAYMENT_QR_BUCKET, uploadPaymentQr } from "@/lib/catalog/payment-qr";
import { CatalogValidationError } from "@/lib/catalog/validation";

export async function POST(request: Request) {
  const staff = await requireAdminStaff();
  if (!staff) return NextResponse.json({ success: false, message: "Unauthorized." }, { status: 401 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    const accountId = form.get("accountId");
    if (!(file instanceof File) || !isCatalogUuid(accountId)) return NextResponse.json({ success: false, message: "Choose a QR image and a valid payment account." }, { status: 400 });
    const client = createAdminClient();
    const account = await client.from("payment_accounts").select("account_id").eq("account_id", accountId).maybeSingle();
    if (account.error) return NextResponse.json({ success: false, message: "Unable to check this payment account." }, { status: 500 });
    if (!account.data) return NextResponse.json({ success: false, message: "Payment account not found." }, { status: 404 });
    const path = await uploadPaymentQr(client, accountId, file);
    const update = await client.from("payment_accounts").update({ qr_image: path }).eq("account_id", accountId).select("account_id").maybeSingle();
    if (update.error || !update.data) {
      await client.storage.from(PAYMENT_QR_BUCKET).remove([path]);
      return NextResponse.json({ success: false, message: "Unable to attach the QR image to this account. Please try again." }, { status: update.error ? 500 : 404 });
    }
    await createAuditLog(staff, { action: "Uploaded payment account QR code", entityType: "payment_account", entityId: accountId });
    return NextResponse.json({ success: true, path });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof CatalogValidationError ? error.message : "Unable to upload the QR image. Check QR storage availability and try again." }, { status: error instanceof CatalogValidationError ? 400 : 500 });
  }
}
