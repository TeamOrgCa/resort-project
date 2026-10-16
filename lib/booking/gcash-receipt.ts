export type OcrStatus = "not_applicable" | "consistent" | "mismatch" | "unreadable";
export type OcrAssessment = { status: OcrStatus; notes: string; amount?: number; reference?: string; paidAt?: string };

export function isGcashMethod(method: { name: string; type: string }): boolean {
  if (method.type.trim().toLowerCase() === "cash") return false;
  return /\bg\s*cash\b/i.test(`${method.name} ${method.type}`);
}

/** Preserve leading zeroes; formatting variations must identify the same transaction. */
export function normalizeGcashReference(value: string): string | null {
  if (!/^[\d\s-]+$/.test(value)) return null;
  const digits = value.replace(/[\s-]/g, "");
  return /^\d{8,20}$/.test(digits) ? digits : null;
}

const hasFailedTransactionStatus = (text: string) =>
  /\b(?:payment|transaction|transfer|send money)\s+(?:was\s+)?(?:failed|unsuccessful|cancelled|canceled|reversed)\b|\b(?:failed|unsuccessful|cancelled|canceled|reversed)\s+(?:payment|transaction|transfer)\b|^\s*(?:failed|unsuccessful|cancelled|canceled|reversed)\s*$/im.test(
    text.split(/\r?\n/).filter((line) => !/^\s*(?:if|when|in case)\b/i.test(line)).join("\n"));

const hasPendingTransactionStatus = (text: string) =>
  /\b(?:payment|transaction|transfer)\s+(?:(?:is|was)\s+)?(?:pending|processing|on hold|in progress)\b|\b(?:pending|processing)\s+(?:payment|transaction|transfer)\b|^\s*(?:pending|processing|on hold|in progress)\s*$/im.test(text);

/** A preliminary screen only. GCash submissions must also pass every field check below. */
export function screenReceiptText(text: string, isGcash: boolean): { plausible: boolean; reason?: string } {
  if (hasFailedTransactionStatus(text)) return { plausible: false, reason: "The uploaded image shows a failed or reversed transaction. Upload proof of a successful payment." };
  if (hasPendingTransactionStatus(text)) return { plausible: false, reason: "The uploaded image shows a pending transaction. Upload the completed payment receipt." };
  const action = /\b(payment|paid|transaction|receipt|transfer(?:red)?|sent|received|deposit(?:ed)?)\b/i.test(text);
  const outcome = /\b(successful|success|completed|confirmed|sent|received|transferred)\b/i.test(text);
  const amount = /(?:PHP|₱|P)\s*[\d,]+(?:\.\d{1,2})?/i.test(text);
  const reference = /\b(reference|ref\s*(?:no|number)?|transaction\s*(?:id|no|number))\b/i.test(text);
  const plausible = isGcash ? /g\s*cash/i.test(text) && action && (outcome || amount || reference)
    : action && (amount || reference) && (outcome || reference);
  return plausible ? { plausible: true } : { plausible: false, reason: "Upload a clear, complete GCash payment receipt." };
}

const referenceLabel = /^(?:reference(?:\s*(?:number|no\.?))?|ref\.?\s*(?:number|no\.?)?|transaction\s*(?:id|number|no\.?))\s*[:#-]?\s*/i;
const amountLabel = /^(?:(?:amount\s*(?:sent|paid)|payment amount|you sent|amount)|total amount(?:\s*sent)?)\s*[:=-]?\s*/i;
const money = /^(?:(?:PHP|₱|P)\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(?:PHP)?$/i;
const normalizedName = (value: string) => value.toUpperCase().replace(/[^A-Z]/g, "");

function receiptAmounts(lines: string[]): number[] {
  const primary: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].match(amountLabel);
    if (!label) continue;
    if (/^total/i.test(label[0])) continue;
    const value = lines[i].slice(label[0].length) || lines[i + 1] || "";
    const match = value.match(money);
    if (!match) continue;
    const amount = Number(match[1].replace(/,/g, "") + (match[2] ? `.${match[2]}` : ""));
    primary.push(amount);
  }
  // A fee-inclusive total must never conceal a lower Amount Sent.
  return [...new Set(primary)];
}

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthPattern = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const timePattern = "(?:\\s*,?\\s*(?:at\\s+|Time\\s*:\\s*)?)(\\d{1,2}):(\\d{2})(?::(\\d{2}))?\\s*(AM|PM)?\\b";
const dateStart = new RegExp(`\\b(?:${monthPattern}\\.?\\s*\\d{1,2}|\\d{1,2}\\s*${monthPattern}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})`, "i");

/** GCash displays local Philippine time. Never let the server's timezone interpret it. */
export function readGcashReceiptDates(text: string): string[] {
  const candidates: string[] = [];
  const patterns = [
    { regex: new RegExp(`\\b${monthPattern}\\.?\\s*(\\d{1,2}),?\\s*(\\d{4})${timePattern}`, "gi"), order: "mdy" },
    { regex: new RegExp(`\\b(\\d{1,2})\\s*${monthPattern}\\.?[,]?\\s*(\\d{4})${timePattern}`, "gi"), order: "dmy" },
    { regex: new RegExp(`\\b(\\d{4})-(\\d{2})-(\\d{2})${timePattern}`, "gi"), order: "ymd" },
    { regex: new RegExp(`\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})${timePattern}`, "gi"), order: "numeric" },
  ];
  for (const { regex, order } of patterns) for (const match of text.matchAll(regex)) {
    const year = Number(order === "ymd" ? match[1] : match[3]);
    const month = order === "mdy" ? months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1
      : order === "dmy" ? months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1
      : Number(order === "ymd" ? match[2] : match[1]);
    const day = Number(order === "mdy" || order === "numeric" ? match[2] : order === "ymd" ? match[3] : match[1]);
    let hour = Number(match[4]);
    const minute = Number(match[5]), second = Number(match[6] ?? 0), period = match[7]?.toUpperCase();
    if (period && (hour < 1 || hour > 12)) continue;
    if (period) hour = hour % 12 + (period === "PM" ? 12 : 0);
    if (year < 2020 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) continue;
    const local = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    if (local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day) continue;
    candidates.push(new Date(local.getTime() - 8 * 3600000).toISOString());
  }
  return [...new Set(candidates)];
}

function recipientMatches(lines: string[], name?: string | null, number?: string | null): boolean {
  const label = /^(?:sent to|paid to|payment to|recipient|receiver|to|merchant|account name)\b\s*:?\s*/i;
  const stop = /^(?:amount|total|reference|ref\b|transaction|date|time|from|sender|fee|balance)/i;
  const parts: string[] = [];
  for (let i = 0; i < lines.length; i++) if (label.test(lines[i])) {
    parts.push(lines[i].replace(label, ""));
    for (let j = i + 1; j < Math.min(i + 4, lines.length) && !stop.test(lines[j]); j++) parts.push(lines[j]);
  }
  // Some Send Money layouts print recipient name/phone above Amount, without a To label.
  if (!parts.length) {
    const end = lines.findIndex((line) => amountLabel.test(line));
    if (end >= 0) parts.push(...lines.slice(0, end));
  }
  const wantedNumber = (number ?? "").replace(/\D/g, "").replace(/^63(?=9\d{9}$)/, "0");
  const phones = parts.flatMap((part) => [...part.matchAll(/(?:\+?63|0)\s*[\d*xX•●·∙⋅.…][\d*xX•●·∙⋅.…\s-]{7,24}/g)]
    .map((match) => match[0].replaceAll("…", "...").replace(/[\s+-]/g, "").replace(/^63/, "0")));
  if (phones.length && wantedNumber) {
    return phones.some((phone) => phone.length === wantedNumber.length && phone.replace(/\D/g, "").length >= 6 && phone.split("").every((char, index) => /[*xX•●·∙⋅.]/.test(char) || char === wantedNumber[index]));
  }
  const wantedName = normalizedName(name ?? "");
  return wantedName.length >= 6 && parts.some((part) => normalizedName(part) === wantedName);
}

export function assessGcashText(text: string, expected: {
  amount: number; minimumAmount?: number; reference: string; recipientName?: string | null;
  recipientNumber?: string | null; now?: number;
  successCheckSeen?: boolean;
}): OcrAssessment {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const findings: string[] = [];
  let mismatch = false;
  if (!/g\s*cash/i.test(text)) findings.push("GCash label could not be read");
  if (hasFailedTransactionStatus(text)) { mismatch = true; findings.push("receipt shows a failed or reversed status"); }
  else if (hasPendingTransactionStatus(text)) { mismatch = true; findings.push("receipt shows a pending transaction"); }
  else if (!/\b(successful|success|completed|payment sent|you sent|you have sent|successfully sent|sent successfully)\b/i.test(text)
    && !(expected.successCheckSeen && /^sent\s+via\s+g\s*cash\s*$/im.test(text) && /^total\s+amount\s+sent\b/im.test(text))) findings.push("successful transaction status could not be read");

  const amounts = receiptAmounts(lines);
  const amount = amounts.length === 1 ? amounts[0] : undefined;
  if (amount === undefined) findings.push("sent amount is missing or ambiguous");
  else if (amount <= 0 || amount > 99999999.99 || Math.round(amount * 100) !== Math.round(expected.amount * 100)) {
    mismatch = true; findings.push("receipt amount differs from Amount sent; enter the exact amount on your receipt");
  }
  if (amount !== undefined && Math.round(amount * 100) < Math.round((expected.minimumAmount ?? expected.amount) * 100)) {
    mismatch = true; findings.push("receipt amount is below the selected minimum payment");
  }

  const references: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const label = lines[i].match(referenceLabel);
    if (!label) continue;
    const value = lines[i].slice((label.index ?? 0) + label[0].length) || lines[i + 1] || "";
    // Send Money puts Ref No. and the timestamp in adjacent columns. OCR may join them.
    const footerDate = value.match(dateStart);
    const referenceValue = footerDate?.index !== undefined && readGcashReceiptDates(value.slice(footerDate.index)).length === 1
      ? value.slice(0, footerDate.index).trim() : value;
    const reference = normalizeGcashReference(referenceValue);
    if (reference) references.push(reference);
  }
  const uniqueReferences = [...new Set(references)];
  const reference = uniqueReferences.length === 1 ? uniqueReferences[0] : undefined;
  if (!reference) findings.push("GCash reference number is missing or ambiguous");
  else if (reference !== normalizeGcashReference(expected.reference)) {
    mismatch = true; findings.push("GCash reference number differs from the number entered");
  }
  if (!recipientMatches(lines, expected.recipientName, expected.recipientNumber)) findings.push("resort recipient could not be matched");

  const dates = readGcashReceiptDates(text);
  const paidAt = dates.length === 1 ? dates[0] : undefined;
  const now = expected.now ?? Date.now();
  const phDay = (millis: number) => new Date(millis + 8 * 3600000).toISOString().slice(0, 10);
  if (!paidAt) findings.push("receipt date and time are missing or ambiguous");
  else if (phDay(Date.parse(paidAt)) !== phDay(now) || Date.parse(paidAt) > now + 60000) {
    mismatch = true; findings.push("receipt must be dated today in Philippine time and cannot show a future payment");
  }
  return { status: mismatch ? "mismatch" : findings.length ? "unreadable" : "consistent", amount, reference, paidAt,
    notes: findings.length ? findings.join("; ") : "GCash status, amount, reference, recipient, and today's Philippine date match. Staff must confirm funds in the receiving account." };
}

/** Fail closed even if an OCR worker returns an incomplete consistent result. */
export function isVerifiedGcashReceipt(result: { status: string; notes: string; amount?: number; reference?: string; paidAt?: string }): result is OcrAssessment & { amount: number; reference: string; paidAt: string } {
  return result.status === "consistent" && typeof result.amount === "number" && Number.isFinite(result.amount)
    && result.amount > 0 && result.amount <= 99999999.99
    && Math.abs(result.amount * 100 - Math.round(result.amount * 100)) < 0.000001
    && !!result.reference && normalizeGcashReference(result.reference) === result.reference
    && !!result.paidAt && Number.isFinite(Date.parse(result.paidAt));
}
