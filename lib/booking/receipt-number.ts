import { manilaDateKey } from "./manila-date";

export const generateReceiptNumber = (paymentId: string, issuedAt = new Date()): string =>
  `RCPT-${manilaDateKey(issuedAt).replace(/-/g, "")}-${paymentId.slice(0, 6).toUpperCase()}`;
