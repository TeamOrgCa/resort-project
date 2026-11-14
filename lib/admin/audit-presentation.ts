import { formatManilaDate, formatManilaDateTime } from "@/lib/booking/manila-date";
import { PERMISSION_LABELS, type Permission } from "@/lib/auth/role-access";

export const isAuditUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const words = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
export const auditTitle = (value: string) => words(value).replace(/\b\w/g, letter => letter.toUpperCase());
const fieldAliases: Record<string,string> = { startdatetime: "start", enddatetime: "end", checkin: "start", checkout: "end" };
const canonical = (key: string) => {
  const normalized = key.replace(/_/g, "").toLowerCase();
  return Object.hasOwn(fieldAliases,normalized) ? fieldAliases[normalized] : normalized;
};
const fields: Record<string, string> = {
  adultcount: "Adults", childcount: "Children", unitid: "Accommodation", guestid: "Guest", reservationid: "Booking",
  start: "Scheduled arrival", end: "Scheduled departure", specialrequests: "Guest requests", isactive: "Account access",
  totalamount: "Booking total", newtotal: "Updated booking total", paidamount: "Verified payments", verifiednetpaid: "Verified payments after refunds",
  balance: "Remaining balance", balancebefore: "Previous balance", balanceafter: "Remaining balance", overpaidamount: "Excess payment",
  reference: "Transaction reference", referencenumber: "Reference", transactionreference: "Transaction reference", paymentmethod: "Payment method",
  paymentmethodid: "Payment method", checkedinat: "Guest checked in", checkedoutat: "Guest checked out", noshowat: "No-show recorded",
  reason: "Reason", changenote: "Reason for revision", guestcountchanged: "Guest count changed", aftercheckin: "Changed during a checked-in stay",
  fundsreceived: "Funds received and acknowledged", receiptnumber: "Receipt number", previousversion: "Previous version", newversion: "New version",
  payoutverificationnotes: "Transfer verification notes", oldstatus: "Previous status", newstatus: "New status", permissions: "Allowed actions",
};
const modules: Record<string, string> = {
  public_access_sale:"Public access", reservation: "Reservations", reservations: "Reservations", reservation_reschedule: "Rescheduling", reservation_reschedules: "Rescheduling",
  payment: "Payments", payments: "Payments", refund_request: "Refunds", refund_requests: "Refunds", transaction: "Billing", transactions: "Billing",
  ocular_visit: "Ocular visits", ocular_visits: "Ocular visits", maintenance_block: "Maintenance", maintenance_blocks: "Maintenance",
  staff_session: "Account access", guest_session: "Account access", auth: "Account access", login: "Account access", staff_user: "Staff accounts", guest_account: "Guest accounts",
  role_permissions: "Permissions", business_settings: "Configuration", package_rates: "Package rates", booking_policy: "Booking rules", booking_policy_versions: "Booking rules",
  reservation_policies: "Terms and privacy", review: "Guest feedback", reviews: "Guest feedback", services: "Business catalog", units: "Business catalog",
  payment_account: "Payment accounts", payment_accounts: "Payment accounts", payment_methods: "Payment methods", ocular_time_slots: "Ocular time slots",
};
const actions: Record<string, string> = {
  "staff created": "Created a staff account", "staff edited": "Updated a staff account", "staff enabled": "Reactivated a staff account", "staff disabled": "Deactivated a staff account",
  "login": "Signed in", "logout": "Signed out", "password reset": "Reset a staff password", "session invalidated by another login": "Ended the earlier session after another sign-in",
  "refund approved": "Approved the refund; awaiting cashier transfer", "refund rejected": "Rejected the refund request",
  "refund payout submitted": "Submitted the refund transfer for manager verification", "refund refunded": "Verified the transfer and completed the refund",
  "recorded staff payment": "Recorded a received payment and issued a receipt", "recorded guest check-in": "Recorded the guest's arrival",
  "checked out guest and completed stay": "Checked out the guest and completed the stay", "marked reservation no show": "Recorded that the guest did not arrive",
  "published legal policy version": "Published a new Terms or Privacy Policy version", "edited reservation and bill": "Updated the reservation and its bill",
};
const statuses: Record<string, string> = { staff: "Manager", admin: "Administrator", cashier: "Cashier", no_show: "No show", payment_submitted: "Payment awaiting verification", reschedule_requested: "Reschedule awaiting approval", partial: "Partially paid", partially_paid: "Partially paid", not_applicable: "Not applicable" };
const money = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const mapped = (entries: Record<string,string>, key: string) => Object.hasOwn(entries, key) ? entries[key] : undefined;
const moneyField = (key: string) => /amount|balance|total|price|fee|deduction|refundable|baserate|perhead|deposit/i.test(key) && !/_id$|Id$|changed|version|count|kind|type/.test(key);

export function auditModule(type: string | null) { return type ? mapped(modules,type) ?? auditTitle(type) : "General"; }
export function auditAction(action: string) {
  const normalized = words(action).trim().toLowerCase();
  if (mapped(actions,normalized)) return actions[normalized];
  const catalog = /^(Created|Updated|Archived|Restored) (services|units|payment_methods|payment_accounts|ocular_time_slots|reservation_policies|unit_rates|guest_rates) record$/i.exec(action);
  if (catalog) return `${auditTitle(catalog[1])} ${({ services: "a service", units: "an accommodation", payment_methods: "a payment method", payment_accounts: "a receiving account", ocular_time_slots: "an ocular time slot", reservation_policies: "a catalog policy", unit_rates: "an accommodation rate", guest_rates: "a guest rate" } as Record<string, string>)[catalog[2].toLowerCase()]}`;
  const readable = words(action).trim();
  return readable ? readable[0].toUpperCase() + readable.slice(1) : "Recorded activity";
}

export function auditSummary(details: Record<string, unknown> | null, labels: Map<string, string>, entityType: string | null): string {
  if (!details || !Object.keys(details).length) return "No additional details were saved for this action.";
  const lines: string[] = [];
  const label = (key: string) => mapped(fields,canonical(key)) ?? auditTitle(key);
  const format = (key: string, value: unknown): string => {
    if (value === null || value === undefined || value === "") return "Not recorded";
    if (typeof value === "boolean") return canonical(key) === "isactive" ? value ? "Active" : "Deactivated" : value ? "Yes" : "No";
    if (typeof value === "string" && isAuditUuid(value)) return labels.get(value) ?? "Name or reference unavailable";
    if (typeof value === "number" || typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)) {
      if (moneyField(key)) return money.format(Number(value));
    }
    if (typeof value === "string") {
      if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) return `${formatManilaDateTime(value)} (Philippine time)`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))) return formatManilaDate(value);
      if (canonical(key).includes("status") && entityType?.includes("refund")) return mapped({ pending: "Awaiting manager approval", reviewed: "Reviewed; awaiting manager approval", approved: "Approved; awaiting cashier transfer", payout_submitted: "Transfer submitted; awaiting manager verification", refunded: "Refund completed", rejected: "Refund rejected" },value) ?? auditTitle(value);
      if (canonical(key).includes("status")) return mapped(statuses,value) ?? auditTitle(value);
      if (canonical(key) === "role" && mapped(statuses,value)) return statuses[value];
      if (canonical(key).includes("permissions") && Object.hasOwn(PERMISSION_LABELS, value)) return PERMISSION_LABELS[value as Permission];
      return value;
    }
    if (Array.isArray(value)) return value.length ? value.map(item => {
      const row = object(item);
      if (row) {
        const id = row.serviceId ?? row.service_id ?? row.unitId ?? row.unit_id;
        if (typeof id === "string") return `${labels.get(id) ?? "Item name unavailable"} × ${row.quantity ?? "Not recorded"}`;
        return Object.entries(row).map(([name, entry]) => `${label(name)}: ${format(name, entry)}`).join("; ");
      }
      return format(key, item);
    }).join(", ") : "None";
    const row = object(value);
    return row ? Object.entries(row).map(([name, entry]) => `${label(name)}: ${format(name, entry)}`).join("; ") : String(value);
  };
  const before = object(details.before), after = object(details.after);
  // Compare only fields that were actually recorded in both snapshots. A patch
  // omitting a field does not mean that field was cleared.
  if (before && after) {
    const compare = (old: Record<string, unknown>, next: Record<string, unknown>, prefix = "") => {
      for (const [key, value] of Object.entries(next)) {
        const oldKey = Object.keys(old).find(candidate => canonical(candidate) === canonical(key));
        if (!oldKey || JSON.stringify(old[oldKey]) === JSON.stringify(value)) continue;
        if (object(old[oldKey]) && object(value)) compare(object(old[oldKey])!, object(value)!, `${prefix}${label(key)} / `);
        else lines.push(`${prefix}${label(key)}: ${format(key, old[oldKey])} → ${format(key, value)}`);
      }
    };
    compare(before, after);
    // Service selections and the old bill are saved separately by booking edits.
    if (after.services !== undefined && details.before_services !== undefined && format("services", after.services) !== format("services", details.before_services)) lines.push(`Services: ${format("services", details.before_services)} → ${format("services", after.services)}`);
    const oldBill = object(details.before_bill);
    if (oldBill?.total_amount !== undefined && details.new_total !== undefined && Number(oldBill.total_amount) !== Number(details.new_total)) lines.push(`Booking total: ${format("total_amount", oldBill.total_amount)} → ${format("new_total", details.new_total)}`);
  }
  if (details.old_status !== undefined && details.new_status !== undefined) lines.push(`Status: ${format("status", details.old_status)} → ${format("status", details.new_status)}`);
  for (const [key, value] of Object.entries(details)) {
    if (["before", "after", "before_bill", "before_services", "before_units", "old_status", "new_status"].includes(key)) continue;
    if (/(?:proof|path|token|password|fingerprint|quote|same_actor)/i.test(key)) continue;
    if (key === "new_total" && lines.some(line => line.startsWith("Booking total:"))) continue;
    if (key === "reason" && !value) continue;
    lines.push(`${label(key)}: ${format(key, value)}`);
  }
  return lines.join("\n") || "The action was recorded without a detailed change summary. Open Technical details to inspect the original record.";
}
