export type OcrStatus = "not_applicable" | "consistent" | "mismatch" | "unreadable";
export type OcrAssessment = { status: OcrStatus; notes: string };

const hasFailedTransactionStatus = (text: string) =>
  /\b(?:payment|transaction|transfer|send money)\s+(?:was\s+)?(?:failed|unsuccessful|cancelled|canceled|reversed)\b|\b(?:failed|unsuccessful|cancelled|canceled|reversed)\s+(?:payment|transaction|transfer)\b|^\s*(?:failed|unsuccessful|cancelled|canceled|reversed)\s*$/im.test(text)
  && !/\b(successful|success|completed|confirmed|sent successfully)\b/i.test(text);

/** Reject only clear non-receipts; partial receipt text still goes to staff review. */
export function screenReceiptText(text: string, isGcash: boolean): { plausible: boolean; reason?: string } {
  const hasGcash = /g\s*cash/i.test(text);
  const hasPaymentAction = /\b(payment|paid|transaction|receipt|transfer(?:red)?|sent|received|deposit(?:ed)?)\b/i.test(text);
  const hasOutcome = /\b(successful|success|completed|confirmed|sent|received|transferred)\b/i.test(text);
  const hasAmount = /(?:PHP|₱|P)\s*[\d,]+(?:\.\d{1,2})?/i.test(text);
  const hasReference = /\b(reference|ref(?:erence)?\s*(?:no|number)?|transaction\s*(?:id|no|number)|trace\s*(?:no|number))\b/i.test(text);

  if (hasFailedTransactionStatus(text)) {
    return { plausible: false, reason: "The uploaded image shows a failed or reversed transaction. Upload proof of a successful payment." };
  }

  const plausible = isGcash
    ? (hasGcash && hasPaymentAction && (hasOutcome || hasAmount || hasReference))
      || (hasPaymentAction && hasOutcome && hasAmount && hasReference)
    : hasPaymentAction && (hasAmount || hasReference) && (hasOutcome || hasReference);

  return plausible
    ? { plausible: true }
    : { plausible: false, reason: "The uploaded image does not show enough receipt or transaction details. Upload a clear payment receipt." };
}

const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export function assessGcashText(
  text: string,
  expected: { amount: number; reference: string; recipientName?: string | null; recipientNumber?: string | null },
): OcrAssessment {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const compactText = normalize(text);
  const findings: string[] = [];
  let mismatch = false;

  if (!/g\s*cash/i.test(text)) findings.push("GCash label could not be read");
  if (hasFailedTransactionStatus(text)) {
    mismatch = true;
    findings.push("receipt shows a failed or reversed status");
  } else if (!/\b(successful|success|completed|payment sent|you sent|sent successfully)\b/i.test(text)) {
    findings.push("successful transaction status could not be read");
  }

  const amounts = lines.flatMap((line, index) => {
    if (!/\b(amount sent|total amount|amount paid|payment amount|you sent|amount)\b/i.test(line)) return [];
    return [line, lines[index + 1] ?? ""].flatMap((candidate) =>
      [...candidate.matchAll(/(?:PHP|₱|P)\s*([\d,]+(?:\.\d{1,2})?)/gi)]
        .map((match) => Number(match[1].replace(/,/g, ""))));
  });
  if (!amounts.length) findings.push("sent amount could not be read");
  else if (!amounts.some((amount) => Math.round(amount * 100) === Math.round(expected.amount * 100))) {
    mismatch = true;
    findings.push("sent amount differs from the reservation payment");
  }

  const reference = normalize(expected.reference);
  if (reference.length < 8 || !compactText.includes(reference)) {
    const referenceLine = lines.find((line) => /\b(reference|ref(?:erence)?\s*(?:no|number)|transaction\s*id)\b/i.test(line));
    if (referenceLine && /\d{8,}/.test(normalize(referenceLine))) mismatch = true;
    findings.push("transaction reference could not be matched");
  }

  const recipientDigits = expected.recipientNumber?.replace(/\D/g, "") ?? "";
  const recipientName = normalize(expected.recipientName ?? "");
  const recipientMatches = recipientDigits.length >= 4 && compactText.includes(recipientDigits.slice(-4))
    || recipientName.length >= 6 && compactText.includes(recipientName);
  if (!recipientMatches) findings.push("resort recipient could not be matched");

  return {
    status: mismatch ? "mismatch" : findings.length ? "unreadable" : "consistent",
    notes: findings.length ? findings.join("; ") : "GCash label, status, amount, reference, and recipient match the uploaded image. Confirm funds in the merchant transaction record.",
  };
}
