import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveCatalog } from "@/repositories/catalogRepository";

export async function GET() {
  try {
    const catalog = await getActiveCatalog(await createClient());
    const adminClient = createAdminClient();
    const paymentAccounts = await Promise.all(catalog.paymentAccounts.map(async (account) => {
      if (!account.qr_image) return account;
      const { data } = await adminClient.storage.from("payment-qr-codes").createSignedUrl(account.qr_image, 3600);
      return { ...account, qr_image: data?.signedUrl ?? null };
    }));
    return NextResponse.json({ success: true, catalog: { ...catalog, paymentAccounts } }, { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } });
  } catch {
    return NextResponse.json({ success: false, message: "Failed to load resort catalog." }, { status: 500 });
  }
}