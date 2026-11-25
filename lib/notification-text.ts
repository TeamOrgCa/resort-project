import { formatHourDurations } from "@/lib/format-hour-durations";

/** Keep saved notification copy readable and omit internal payment-review mechanics. */
export function formatNotificationText(value: string): string {
  const text = formatHourDurations(value)
    .replace(/\bPayment automatically approved\b/gi, "Payment approved")
    .replace(/\bwas confirmed after automatic OCR payment approval\b/gi, "is confirmed. Your payment was approved")
    .replace(/\bwas automatically approved because its receipt passed OCR validation\b/gi, "was approved");
  return text.replace(/(\bPHP\s*|₱\s*)(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?!\d|,\d)/gi, (match, currency: string, amount: string) => {
    const number = Number(amount.replace(/,/g, ""));
    return Number.isFinite(number)
      ? `${currency}${number.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : match;
  });
}
