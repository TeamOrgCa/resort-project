import nodemailer from "nodemailer";
import type { BillingBreakdown } from "@/lib/booking/billing-breakdown";
import { getEmailBranding } from "@/lib/server/email-branding";

interface ReservationEmailBase {
  guestEmail: string;
  guestName: string;
  reservationReference: string;
  checkInDate?: string | null;
  checkOutDate?: string | null;
}

interface BillingEmailBase {
  guestEmail: string;
  guestName: string;
  reservationReference: string;
  checkInDate: string;
  checkOutDate: string;
  bookingMode: string;
  adultCount: number;
  childCount: number;
  breakdown: BillingBreakdown;
}

interface ReceiptEmailPayload extends BillingEmailBase {
  receiptNumber: string;
  issuedAt: string;
  amountPaid: number;
  totalAmount: number;
  balance: number;
}

interface InvoiceEmailPayload extends BillingEmailBase {
  issuedAt: string;
  totalAmount: number;
  paidAmount: number;
  balance: number;
}

interface ReservationCancelledEmailPayload extends ReservationEmailBase {
  cancellationReason: string;
  refundSummary?: string;
}

interface OcularVisitCancelledEmailPayload extends OcularVisitEmailPayload {
  cancellationReason: string;
}

interface OcularVisitEmailPayload {
  guestEmail: string;
  guestName: string;
  referenceNumber: string;
  scheduledDate: string;
  timeSlot: string;
}

const appName = process.env.EMAIL_APP_NAME ?? "MarVille Resort Complex";
const senderName = process.env.EMAIL_FROM_NAME ?? appName;
const senderEmail = process.env.EMAIL_FROM ?? process.env.EMAIL_USER;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

// Table-based structure and inline colors also work in email clients that strip
// stylesheets. Brand text remains visible when remote images are blocked.
const emailLayout = (subject: string, content: string, logoUrl: string | null) => `<!doctype html>
<html lang="en" style="color-scheme:only light"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="only light">
<title>${escapeHtml(subject)}</title>
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  table{mso-table-lspace:0pt;mso-table-rspace:0pt}
  .email-copy p{margin:0 0 16px}.email-copy h3{font-size:17px;color:#3B2A1E;margin:24px 0 12px}
  @media only screen and (max-width:600px){.email-outer{padding:16px 8px!important}.email-padding{padding:24px 20px!important}.email-brand{font-size:22px!important}.email-copy h2{font-size:25px!important}}
</style></head>
<body style="margin:0;padding:0;background-color:#F8F4EC;color:#3B2A1E;font-family:'Segoe UI',Arial,sans-serif;line-height:1.65">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeHtml(subject)} — an update from ${escapeHtml(appName)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F8F4EC"><tr><td class="email-outer" align="center" style="padding:40px 16px">
<!--[if mso]><table role="presentation" width="640" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background-color:#FFFFFF;border:1px solid #E9DFD3;border-radius:20px;overflow:hidden">
<tr><td height="6" bgcolor="#F4C430" style="font-size:0;line-height:6px">&nbsp;</td></tr>
<tr><td class="email-padding" bgcolor="#A9442B" style="padding:30px 36px;color:#FFFFFF">
  ${logoUrl ? `<table role="presentation" cellpadding="0" cellspacing="0" bgcolor="#FFFFFF" style="margin:0 0 20px;border-radius:12px"><tr><td style="padding:12px"><img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(appName)} logo" width="180" style="display:block;width:180px;max-width:100%;height:auto;border:0"></td></tr></table>` : ""}
  <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#FFE4D5">Your private resort escape</p>
  <p class="email-brand" style="margin:0;font-size:27px;line-height:1.25;font-weight:700;color:#FFFFFF">${escapeHtml(appName)}</p>
  <p style="margin:10px 0 0;font-size:13px;color:#FFF1D6">Where the Sun Never Sets</p>
</td></tr>
<tr><td class="email-padding email-copy" bgcolor="#FFFFFF" style="padding:32px 36px;color:#3B2A1E;font-size:15px;line-height:1.65;overflow-wrap:break-word;word-wrap:break-word">${content}</td></tr>
<tr><td class="email-padding" bgcolor="#F8F4EC" style="padding:24px 36px;border-top:1px solid #E9DFD3">
  <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:#2F6B3F">Here to help you plan your visit</p>
  <p style="margin:0;font-size:13px;color:#705D4E">Call <a href="tel:+639172796592" style="color:#A9442B;text-decoration:underline">09172796592</a> or <a href="tel:82360633" style="color:#A9442B;text-decoration:underline">82360633</a>.</p>
  <p style="margin:14px 0 0;font-size:11px;color:#705D4E">${escapeHtml(appName)} &middot; Taytay, Rizal<br>This email contains updates about your account or visit.</p>
</td></tr>
<tr><td height="5" bgcolor="#2F6B3F" style="font-size:0;line-height:5px">&nbsp;</td></tr>
</table><!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;

const formatDateLabel = (value?: string | null) => {
  if (!value) {
    return "TBA";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
};

const formatDateTimeLabel = (value?: string | null) => {
  if (!value) return "TBA";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true, // set to false if you want 24-hour format
    timeZone: "Asia/Manila",
  });
};

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

const billingLines = (payload: BillingEmailBase) => [
  `Reservation: ${payload.reservationReference}`,
  `Booking type: ${payload.bookingMode}`,
  `Guests: ${payload.adultCount} adults, ${payload.childCount} children`,
  `Check-in: ${formatDateTimeLabel(payload.checkInDate)}`,
  `Check-out: ${formatDateTimeLabel(payload.checkOutDate)}`,
];

const billingRows = (payload: BillingEmailBase) => [
  ["Reservation", payload.reservationReference],
  ["Booking type", payload.bookingMode],
  ["Guests", `${payload.adultCount} adults, ${payload.childCount} children`],
  ["Check-in", formatDateTimeLabel(payload.checkInDate)],
  ["Check-out", formatDateTimeLabel(payload.checkOutDate)],
];

const billingTable = (rows: string[][]) => `<table class="email-details" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F8F4EC" style="border-collapse:collapse;width:100%;table-layout:fixed;margin:16px 0;border:1px solid #E9DFD3">${rows.map(([label, value]) =>
  `<tr><th scope="row" style="width:35%;text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #E9DFD3;color:#705D4E;font-size:12px;font-weight:600">${escapeHtml(label)}</th><td style="padding:12px;border-bottom:1px solid #E9DFD3;color:#3B2A1E;font-size:14px;font-weight:600;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(value)}</td></tr>`
).join("")}</table>`;

const breakdownText = (breakdown: BillingBreakdown) => [
  "Items availed and charges:",
  ...breakdown.lines.flatMap((line) => [
    `- ${line.description}: ${line.quantity} × ${formatMoney(line.unitPrice)} = ${formatMoney(line.amount)}`,
    `  ${line.detail}`,
  ]),
  `Total charges: ${formatMoney(breakdown.total)}`,
];

const breakdownTable = (breakdown: BillingBreakdown) => `
  <h3 style="margin:24px 0 12px;color:#3B2A1E;font-size:17px">Items availed and charges</h3>
  <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;width:100%;font-size:14px">
    <thead><tr bgcolor="#F8F4EC" style="text-align:left;color:#705D4E">
      <th scope="col" style="padding:10px 12px;font-size:12px">Item</th>
      <th scope="col" style="padding:10px 12px;text-align:right;font-size:12px">Amount</th>
    </tr></thead>
    <tbody>${breakdown.lines.map((line) => `<tr style="border-bottom:1px solid #E9DFD3">
      <td style="padding:14px 12px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word"><strong style="color:#3B2A1E">${escapeHtml(line.description)}</strong><br><span style="color:#705D4E;font-size:12px">${escapeHtml(line.detail)}</span><br><span style="color:#705D4E;font-size:12px">Qty: ${line.quantity} &middot; Rate: ${escapeHtml(formatMoney(line.unitPrice))}</span></td>
      <td style="padding:14px 12px;text-align:right;vertical-align:top;white-space:nowrap;font-weight:600;color:#3B2A1E">${escapeHtml(formatMoney(line.amount))}</td>
    </tr>`).join("")}</tbody>
    <tfoot><tr bgcolor="#EDF4ED"><th scope="row" style="padding:14px 12px;text-align:left;color:#2F6B3F">Total charges</th>
      <td style="padding:14px 12px;text-align:right;white-space:nowrap;font-weight:700;color:#2F6B3F">${escapeHtml(formatMoney(breakdown.total))}</td></tr></tfoot>
  </table>`;

// Standard swimming inclusions and payment timing are from RESORT_CONTEXT.md.
const billingNotesText = (balance: number) => [
  "Standard private pool inclusions (included in the package price): cottage, two air-conditioned rooms with private toilets, videoke, griller, free parking, and consumable food.",
  ...(balance > 0 ? ["The remaining balance is due upon arrival before swimming."] : []),
  "Questions? Call 09172796592 or 82360633.",
];

const billingNotesHtml = (balance: number) => `<p style="margin-top:20px"><strong>Standard private pool inclusions</strong><br>Cottage, two air-conditioned rooms with private toilets, videoke, griller, free parking, and consumable food. These are included in the package price.</p>${balance > 0 ? "<p>The remaining balance is due upon arrival before swimming.</p>" : ""}<p>Questions? Call 09172796592 or 82360633.</p>`;

const formatTimeSlotLabel = (slot: string) => {
  if (!slot.includes("-")) return slot;

  const [start, end] = slot.split("-");

  const formatTime = (time: string) => {
    const [hourRaw, minute] = time.split(":");
    const hour = Number(hourRaw);

    if (Number.isNaN(hour) || !minute) {
      return time;
    }

    const period = hour >= 12 ? "PM" : "AM";
    const normalizedHour = hour % 12 === 0 ? 12 : hour % 12;

    return `${normalizedHour}:${minute} ${period}`;
  };

  return `${formatTime(start)} - ${formatTime(end)}`;
};

const createTransporter = () => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;

  if (!user || !pass) {
    return null;
  }

  const host = process.env.EMAIL_HOST || `smtp.gmail.com`;
  const port = Number(process.env.EMAIL_PORT ?? 587);

  if (host) {
    return nodemailer.createTransport({
      host,
      port,
      secure: process.env.EMAIL_SECURE === "true" || port === 465,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }

  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE ?? "gmail",
    auth: { user, pass },
  });
};

const transporter = createTransporter();
export const isEmailConfigured = () => Boolean(transporter && senderEmail);

const sendMail = async ({
  to,
  subject,
  html,
  text,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) => {
  if (!transporter || !senderEmail) {
    console.error("Email transporter is not configured.");
    return false;
  }

  try {
    const { logoUrl, attachments } = await getEmailBranding();
    const result = await transporter.sendMail({
      from: `\"${senderName}\" <${senderEmail}>`,
      to,
      subject,
      html: emailLayout(subject, html, logoUrl),
      attachments,
      text,
    });
    return result.accepted.length > 0;
  } catch (error) {
    const failure = error as { code?: string; responseCode?: number };
    console.error("Failed to send email.", { code: failure?.code, responseCode: failure?.responseCode });
    return false;
  }
};

export const sendGuestConfirmationEmail = async ({ email, guestName, confirmationUrl }: { email: string; guestName: string; confirmationUrl: string }) => sendMail({
  to: email,
  subject: `Confirm your email for ${appName}`,
  text: [`Hi ${guestName || "Guest"},`, "", `Welcome to ${appName}. Confirm your email address before signing in:`, confirmationUrl, "", "This link can only be used once. If it expires, request another confirmation email from the registration page.", "If you did not create this account, you can ignore this email."].join("\n"),
  html: `<div style="font-family:Arial,sans-serif;color:#3B2A1E;line-height:1.6;width:100%;margin:0;padding:0"><h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">Confirm your email</h2><p>Hi ${escapeHtml(guestName || "Guest")},</p><p>Welcome to ${escapeHtml(appName)}. Confirm your email address before signing in.</p><p style="margin:28px 0"><a href="${escapeHtml(confirmationUrl)}" style="display:inline-block;padding:14px 24px;background:#A9442B;color:#FFFFFF;text-decoration:none;border-radius:28px;font-weight:bold;line-height:1.4;text-align:center">Confirm email address</a></p><p>If the button does not work, open this link:</p><p style="word-break:break-all"><a href="${escapeHtml(confirmationUrl)}" style="color:#A9442B;text-decoration:underline;word-break:break-all">${escapeHtml(confirmationUrl)}</a></p><p>This link can only be used once. If it expires, request another confirmation email from the registration page.</p><p>If you did not create this account, you can ignore this email.</p></div>`,
});

export const sendPaymentReceiptEmail = async (payload: ReceiptEmailPayload) => {
  const lines = [
    `Hi ${payload.guestName || "Guest"},`, "", "Your verified payment receipt is ready.",
    `Receipt: ${payload.receiptNumber}`,
    `Issued: ${formatDateTimeLabel(payload.issuedAt)}`,
    ...billingLines(payload),
    "",
    ...breakdownText(payload.breakdown),
    "",
    `Amount paid: ${formatMoney(payload.amountPaid)}`,
    `Reservation total: ${formatMoney(payload.totalAmount)}`,
    `Remaining balance: ${formatMoney(payload.balance)}`,
    "", ...billingNotesText(payload.balance),
    "", "Keep this email for your records.",
  ];
  const rows = [
    ["Receipt", payload.receiptNumber],
    ["Issued", formatDateTimeLabel(payload.issuedAt)],
    ...billingRows(payload),
  ];
  const paymentRows = [
    ["Amount paid", formatMoney(payload.amountPaid)],
    ["Reservation total", formatMoney(payload.totalAmount)],
    ["Remaining balance", formatMoney(payload.balance)],
  ];
  return sendMail({
    to: payload.guestEmail,
    subject: `Payment Receipt ${payload.receiptNumber}`,
    text: lines.join("\n"),
    html: `<div style="font-family:Arial,sans-serif;color:#3B2A1E;line-height:1.5"><h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">Payment Receipt</h2><p>Hi ${escapeHtml(payload.guestName || "Guest")},</p><p>Your verified payment receipt is ready.</p>${billingTable(rows)}${breakdownTable(payload.breakdown)}<h3>Payment summary</h3>${billingTable(paymentRows)}${billingNotesHtml(payload.balance)}<p>Keep this email for your records.</p></div>`,
  });
};

export const sendReservationInvoiceEmail = async (payload: InvoiceEmailPayload) => {
  const lines = [
    `Hi ${payload.guestName || "Guest"},`, "", "Your reservation invoice is ready.",
    `Issued: ${formatDateTimeLabel(payload.issuedAt)}`,
    ...billingLines(payload),
    "",
    ...breakdownText(payload.breakdown),
    "",
    `Invoice total: ${formatMoney(payload.totalAmount)}`,
    `Payments received: ${formatMoney(payload.paidAmount)}`,
    `Remaining balance: ${formatMoney(payload.balance)}`,
    "", ...billingNotesText(payload.balance),
    "", "You can review your booking in your account.",
  ];
  const rows = [
    ["Issued", formatDateTimeLabel(payload.issuedAt)],
    ...billingRows(payload),
  ];
  const paymentRows = [
    ["Invoice total", formatMoney(payload.totalAmount)],
    ["Payments received", formatMoney(payload.paidAmount)],
    ["Remaining balance", formatMoney(payload.balance)],
  ];
  return sendMail({
    to: payload.guestEmail,
    subject: `Reservation Invoice ${payload.reservationReference}`,
    text: lines.join("\n"),
    html: `<div style="font-family:Arial,sans-serif;color:#3B2A1E;line-height:1.5"><h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">Reservation Invoice</h2><p>Hi ${escapeHtml(payload.guestName || "Guest")},</p><p>Your reservation invoice is ready.</p>${billingTable(rows)}${breakdownTable(payload.breakdown)}<h3>Payment summary</h3>${billingTable(paymentRows)}${billingNotesHtml(payload.balance)}<p>You can review your booking in your account.</p></div>`,
  });
};

export const sendReservationConfirmedEmail = async ({
  guestEmail,
  guestName,
  reservationReference,
  checkInDate,
  checkOutDate,
}: ReservationEmailBase) => {
  const safeName = escapeHtml(guestName || "Guest");
  const safeReference = escapeHtml(reservationReference);
  const formattedCheckIn = formatDateTimeLabel(checkInDate);
  const formattedCheckOut = formatDateTimeLabel(checkOutDate);
  const safeCheckIn = escapeHtml(formattedCheckIn);
  const safeCheckOut = escapeHtml(formattedCheckOut);

  const subject = `Reservation Confirmed - ${reservationReference}`;
  const text = [
    `Hi ${guestName || "Guest"},`,
    "",
    "Your reservation has been confirmed.",
    `Reservation Reference: ${reservationReference}`,
    `Check-in: ${formattedCheckIn}`,
    `Check-out: ${formattedCheckOut}`,
    "",
    "Thank you for choosing us.",
  ].join("\n");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3B2A1E; line-height: 1.6;">
      <h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">Reservation Confirmed</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 16px;">Your reservation has been successfully confirmed.</p>
      <table class="email-details" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F8F4EC" style="border-collapse:collapse;width:100%;table-layout:fixed;border:1px solid #E9DFD3;margin:16px 0">
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Reference</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeReference}</td>
        </tr>
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Check-in</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeCheckIn}</td>
        </tr>
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Check-out</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeCheckOut}</td>
        </tr>
      </table>
      <p style="margin: 16px 0 0;">Thank you for choosing ${escapeHtml(appName)}.</p>
    </div>
  `;

  return sendMail({
    to: guestEmail,
    subject,
    html,
    text,
  });
};

export const sendReservationCancelledEmail = async ({
  guestEmail,
  guestName,
  reservationReference,
  checkInDate,
  checkOutDate,
  cancellationReason,
  refundSummary,
}: ReservationCancelledEmailPayload) => {
  const safeName = escapeHtml(guestName || "Guest");
  const safeReference = escapeHtml(reservationReference);
  const formattedCheckIn = formatDateLabel(checkInDate);
  const formattedCheckOut = formatDateLabel(checkOutDate);
  const safeReason = escapeHtml(cancellationReason);

  const subject = `Reservation Cancelled - ${reservationReference}`;
  const text = [
    `Hi ${guestName || "Guest"},`,
    "",
    "Your reservation has been cancelled.",
    `Reservation Reference: ${reservationReference}`,
    `Check-in: ${formattedCheckIn}`,
    `Check-out: ${formattedCheckOut}`,
    `Reason: ${cancellationReason}`,
    ...(refundSummary ? [refundSummary] : []),
    "",
    "If this is unexpected, please contact support.",
  ].join("\n");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3B2A1E; line-height: 1.6;">
      <h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">Reservation Cancelled</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 16px;">Your reservation has been cancelled.</p>
      <table class="email-details" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F8F4EC" style="border-collapse:collapse;width:100%;table-layout:fixed;border:1px solid #E9DFD3;margin:16px 0">
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Reference</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeReference}</td>
        </tr>
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Check-in</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedCheckIn)}</td>
        </tr>
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Check-out</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedCheckOut)}</td>
        </tr>
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Reason</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeReason}</td>
        </tr>
      </table>
      ${refundSummary ? `<p>${escapeHtml(refundSummary)}</p>` : ""}
      <p style="margin: 16px 0 0;">If this is unexpected, please contact support.</p>
    </div>
  `;

  return sendMail({
    to: guestEmail,
    subject,
    html,
    text,
  });
};

export const sendRefundStatusEmail = async (payload: {
  guestEmail: string; guestName: string; reservationReference: string; amount: number; status: string; notes: string;
}) => {
  const labels: Record<string, string> = { reviewed: "Awaiting manager approval", approved: "Approved - awaiting transfer", rejected: "Rejected",
    payout_submitted: "Transfer submitted - awaiting verification", refunded: "Completed" };
  const status = labels[payload.status] ?? payload.status;
  const text = `Hi ${payload.guestName},\nReservation ${payload.reservationReference}\nRefund: PHP ${Number(payload.amount).toFixed(2)}\nStatus: ${status}\n${payload.notes}\nView updates in Manage Booking. Money is transferred manually; only verified payouts are marked Refunded.`;
  return sendMail({ to: payload.guestEmail, subject: `Refund ${status} - ${payload.reservationReference}`,
    text, html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">Refund update</h2><p style="white-space:pre-wrap">${escapeHtml(text)}</p></div>` });
};

export const sendOcularVisitScheduledEmail = async ({
  guestEmail,
  guestName,
  referenceNumber,
  scheduledDate,
  timeSlot,
}: OcularVisitEmailPayload) => {
  const safeName = escapeHtml(guestName || "Guest");
  const safeReference = escapeHtml(referenceNumber);

  const formattedDate = formatDateLabel(scheduledDate);
  const formattedTimeSlot = formatTimeSlotLabel(timeSlot);

  const subject = `Ocular Visit Scheduled - ${referenceNumber}`;

  const text = [
    `Hi ${guestName || "Guest"},`,
    "",
    "Your ocular visit has been confirmed.",
    "",
    `Reference Number: ${referenceNumber}`,
    `Visit Date: ${formattedDate}`,
    `Time Slot: ${formattedTimeSlot}`,
    "",
    "Your selected date and time slot are reserved.",
    "No staff approval is required.",
    "",
    `Thank you for choosing ${appName}.`,
  ].join("\n");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3B2A1E; line-height: 1.6;">
      <h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">
        Ocular Visit Scheduled
      </h2>

      <p style="margin: 0 0 12px;">
        Hi ${safeName},
      </p>

      <p style="margin: 0 0 16px;">
        Your ocular visit is confirmed. We look forward to welcoming you.
      </p>

      <table class="email-details" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F8F4EC" style="border-collapse:collapse;width:100%;table-layout:fixed;border:1px solid #E9DFD3;margin:16px 0">
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Reference</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeReference}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Visit Date</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedDate)}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Time Slot</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedTimeSlot)}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Status</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">Confirmed</td>
        </tr>
      </table>

      <p style="margin: 16px 0 0;">
        Please arrive at your scheduled time.
      </p>

      <p style="margin: 16px 0 0;">
        Thank you for choosing ${escapeHtml(appName)}.
      </p>
    </div>
  `;

  return sendMail({
    to: guestEmail,
    subject,
    html,
    text,
  });
};

export const sendOcularVisitApprovedEmail = async ({
  guestEmail,
  guestName,
  referenceNumber,
  scheduledDate,
  timeSlot,
}: OcularVisitEmailPayload) => {
  const safeName = escapeHtml(guestName || "Guest");
  const safeReference = escapeHtml(referenceNumber);

  const formattedDate = formatDateLabel(scheduledDate);
  const formattedTimeSlot = formatTimeSlotLabel(timeSlot);

  const subject = `Ocular Visit Approved - ${referenceNumber}`;

  const text = [
    `Hi ${guestName || "Guest"},`,
    "",
    "Your ocular visit has been approved.",
    "",
    `Reference Number: ${referenceNumber}`,
    `Visit Date: ${formattedDate}`,
    `Time Slot: ${formattedTimeSlot}`,
    "",
    "We look forward to welcoming you.",
    "",
    `Thank you for choosing ${appName}.`,
  ].join("\n");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3B2A1E; line-height: 1.6;">
      <h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">
        Ocular Visit Approved
      </h2>

      <p style="margin: 0 0 12px;">
        Hi ${safeName},
      </p>

      <p style="margin: 0 0 16px;">
        Your ocular visit has been approved. We look forward to welcoming you to the resort.
      </p>

      <table class="email-details" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F8F4EC" style="border-collapse:collapse;width:100%;table-layout:fixed;border:1px solid #E9DFD3;margin:16px 0">
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Reference</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeReference}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Visit Date</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedDate)}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Time Slot</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedTimeSlot)}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Status</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3; color: #2F6B3F; font-weight: 600;">
            Approved
          </td>
        </tr>
      </table>

      <p style="margin: 16px 0 0;">
        Please arrive a few minutes before your scheduled visit time.
      </p>

      <p style="margin: 16px 0 0;">
        Thank you for choosing ${escapeHtml(appName)}.
      </p>
    </div>
  `;

  return sendMail({
    to: guestEmail,
    subject,
    html,
    text,
  });
};


export const sendOcularVisitReviewedEmail = async (payload: { guestEmail: string; guestName: string; referenceNumber: string; scheduledDate: string; approved: boolean; reason: string }) => {
  const title = payload.approved ? "Ocular Visit Confirmed" : "Ocular Visit Rejected";
  const date = formatDateLabel(payload.scheduledDate);
  return sendMail({ to: payload.guestEmail, subject: `${title} - ${payload.referenceNumber}`,
    text: `Hi ${payload.guestName || "Guest"},\n\n${title}\nReference: ${payload.referenceNumber}\nScheduled date: ${date}\nReason: ${payload.reason}\n\nView your visit details in your account.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">${title}</h2><p>Hi ${escapeHtml(payload.guestName || "Guest")},</p>${billingTable([["Reference", payload.referenceNumber], ["Scheduled date", date], ["Reason", payload.reason]])}<p>View your visit details in your account.</p></div>` });
};

export const sendOcularVisitCancelledEmail = async ({
  guestEmail,
  guestName,
  referenceNumber,
  scheduledDate,
  timeSlot,
  cancellationReason,
}: OcularVisitCancelledEmailPayload) => {
  const safeName = escapeHtml(guestName || "Guest");
  const safeReference = escapeHtml(referenceNumber);

  const formattedDate = formatDateLabel(scheduledDate);
  const formattedTimeSlot = formatTimeSlotLabel(timeSlot);

  const safeReason = escapeHtml(cancellationReason);

  const subject = `Ocular Visit Cancelled - ${referenceNumber}`;

  const text = [
    `Hi ${guestName || "Guest"},`,
    "",
    "Your ocular visit has been cancelled.",
    "",
    `Reference Number: ${referenceNumber}`,
    `Visit Date: ${formattedDate}`,
    `Time Slot: ${formattedTimeSlot}`,
    `Reason: ${cancellationReason}`,
    "",
    "If this is unexpected, please contact support.",
    "",
    `Thank you for choosing ${appName}.`,
  ].join("\n");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #3B2A1E; line-height: 1.6;">
      <h2 style="margin:0 0 20px;color:#3B2A1E;font-size:28px;line-height:1.25;font-weight:700">
        Ocular Visit Cancelled
      </h2>

      <p style="margin: 0 0 12px;">
        Hi ${safeName},
      </p>

      <p style="margin: 0 0 16px;">
        Your ocular visit has been cancelled.
      </p>

      <table class="email-details" cellpadding="0" cellspacing="0" width="100%" bgcolor="#F8F4EC" style="border-collapse:collapse;width:100%;table-layout:fixed;border:1px solid #E9DFD3;margin:16px 0">
        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Reference</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeReference}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Visit Date</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedDate)}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Time Slot</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${escapeHtml(formattedTimeSlot)}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Reason</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3;font-size:14px;overflow-wrap:anywhere;word-break:break-word">${safeReason}</td>
        </tr>

        <tr>
          <td style="width:35%;padding:12px;border-bottom:1px solid #E9DFD3;font-size:12px;color:#705D4E;vertical-align:top;font-weight:600">Status</td>
          <td style="padding:12px;border-bottom:1px solid #E9DFD3; color: #A9442B; font-weight: 600;">
            Cancelled
          </td>
        </tr>
      </table>

      <p style="margin: 16px 0 0;">
        If this cancellation is unexpected, please contact support for assistance.
      </p>

      <p style="margin: 16px 0 0;">
        Thank you for choosing ${escapeHtml(appName)}.
      </p>
    </div>
  `;

  return sendMail({
    to: guestEmail,
    subject,
    html,
    text,
  });
};
