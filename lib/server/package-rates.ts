import type { SupabaseClient } from "@supabase/supabase-js";
import { parsePackageRateSchedule } from "@/lib/booking/package-rates";

export class PackageRatesError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}

export async function loadPackageRates(client: SupabaseClient, version: number | null = null) {
  const { data, error } = await client.rpc("get_package_rates", { p_version: version }).maybeSingle();
  const schedule = parsePackageRateSchedule(data);
  if (error || !schedule) throw new PackageRatesError("Package rates are unavailable. Ask an administrator to apply the package-rates migration.");
  return schedule;
}

export async function loadQuotedPackageRates(client: SupabaseClient, expectedVersion: number) {
  const current = await loadPackageRates(client);
  if (current.version !== expectedVersion) throw new PackageRatesError("Package rates changed. Return to the booking form to review the new total before saving.", 409);
  return current;
}
