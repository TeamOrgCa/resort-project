import nodemailer from "nodemailer";
import type { BillingBreakdown } from "@/lib/booking/billing-breakdown";

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

const appName = process.env.EMAIL_APP_NAME ?? "Marville Resort";
const senderName = process.env.EMAIL_FROM_NAME ?? appName;
const senderEmail = process.env.EMAIL_FROM ?? process.env.EMAIL_USER;

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");

const formatDateLabel = (value?: string | null) => {
  if (!value) {
    return "TBA";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-PH", {
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

const billingTable = (rows: string[][]) => `<table style="border-collapse:collapse;width:100%;max-width:480px">${rows.map(([label, value]) =>
  `<tr><th scope="row" style="text-align:left;padding:7px 12px 7px 0">${escapeHtml(label)}</th><td style="padding:7px 0">${escapeHtml(value)}</td></tr>`
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
  <h3 style="margin:24px 0 8px">Items availed and charges</h3>
  <table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px">
    <thead><tr style="border-bottom:2px solid #d1d5db;text-align:left">
      <th style="padding:8px 6px">Item</th><th style="padding:8px 6px;text-align:right">Qty</th>
      <th style="padding:8px 6px;text-align:right">Rate</th><th style="padding:8px 6px;text-align:right">Amount</th>
    </tr></thead>
    <tbody>${breakdown.lines.map((line) => `<tr style="border-bottom:1px solid #e5e7eb">
      <td style="padding:9px 6px"><strong>${escapeHtml(line.description)}</strong><br><span style="color:#6b7280">${escapeHtml(line.detail)}</span></td>
      <td style="padding:9px 6px;text-align:right">${line.quantity}</td>
      <td style="padding:9px 6px;text-align:right">${escapeHtml(formatMoney(line.unitPrice))}</td>
      <td style="padding:9px 6px;text-align:right">${escapeHtml(formatMoney(line.amount))}</td>
    </tr>`).join("")}</tbody>
    <tfoot><tr><th colspan="3" style="padding:10px 6px;text-align:right">Total charges</th>
      <th style="padding:10px 6px;text-align:right">${escapeHtml(formatMoney(breakdown.total))}</th></tr></tfoot>
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

  const host = process.env.EMAIL_HOST;
  const port = Number(process.env.EMAIL_PORT ?? 587);

  if (host) {
    return nodemailer.createTransport({
      host,
      port,
      secure: process.env.EMAIL_SECURE === "true" || port === 465,
      auth: { user, pass },
    });
  }

  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE ?? "gmail",
    auth: { user, pass },
  });
};

const transporter = createTransporter();

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
    await transporter.sendMail({
      from: `\"${senderName}\" <${senderEmail}>`,
      to,
      subject,
      html,
      text,
    });
    return true;
  } catch (error) {
    console.error("Failed to send email.", error);
    return false;
  }
};

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
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h2>Payment Receipt</h2><p>Hi ${escapeHtml(payload.guestName || "Guest")},</p><p>Your verified payment receipt is ready.</p>${billingTable(rows)}${breakdownTable(payload.breakdown)}<h3>Payment summary</h3>${billingTable(paymentRows)}${billingNotesHtml(payload.balance)}<p>Keep this email for your records.</p></div>`,
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
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937;line-height:1.5"><h2>Reservation Invoice</h2><p>Hi ${escapeHtml(payload.guestName || "Guest")},</p><p>Your reservation invoice is ready.</p>${billingTable(rows)}${breakdownTable(payload.breakdown)}<h3>Payment summary</h3>${billingTable(paymentRows)}${billingNotesHtml(payload.balance)}<p>You can review your booking in your account.</p></div>`,
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
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px; color: #0f172a;">Reservation Confirmed</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 16px;">Your reservation has been successfully confirmed.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 420px;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Reference</td>
          <td style="padding: 8px 0;">${safeReference}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Check-in</td>
          <td style="padding: 8px 0;">${safeCheckIn}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Check-out</td>
          <td style="padding: 8px 0;">${safeCheckOut}</td>
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
    "",
    "If this is unexpected, please contact support.",
  ].join("\n");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px; color: #991b1b;">Reservation Cancelled</h2>
      <p style="margin: 0 0 12px;">Hi ${safeName},</p>
      <p style="margin: 0 0 16px;">Your reservation has been cancelled.</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 420px;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Reference</td>
          <td style="padding: 8px 0;">${safeReference}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Check-in</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedCheckIn)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Check-out</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedCheckOut)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Reason</td>
          <td style="padding: 8px 0;">${safeReason}</td>
        </tr>
      </table>
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
    "Your ocular visit request has been successfully submitted.",
    "",
    `Reference Number: ${referenceNumber}`,
    `Visit Date: ${formattedDate}`,
    `Time Slot: ${formattedTimeSlot}`,
    "",
    "Your request is currently pending confirmation.",
    "We will notify you once it has been reviewed.",
    "",
    `Thank you for choosing ${appName}.`,
  ].join("\n");

  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px; color: #0f172a;">
        Ocular Visit Scheduled
      </h2>

      <p style="margin: 0 0 12px;">
        Hi ${safeName},
      </p>

      <p style="margin: 0 0 16px;">
        Your ocular visit request has been successfully submitted and is currently pending confirmation.
      </p>

      <table style="border-collapse: collapse; width: 100%; max-width: 420px;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Reference</td>
          <td style="padding: 8px 0;">${safeReference}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Visit Date</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedDate)}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Time Slot</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedTimeSlot)}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Status</td>
          <td style="padding: 8px 0;">Pending Confirmation</td>
        </tr>
      </table>

      <p style="margin: 16px 0 0;">
        We will notify you once your ocular visit has been reviewed and confirmed.
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
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px; color: #166534;">
        Ocular Visit Approved
      </h2>

      <p style="margin: 0 0 12px;">
        Hi ${safeName},
      </p>

      <p style="margin: 0 0 16px;">
        Your ocular visit has been approved. We look forward to welcoming you to the resort.
      </p>

      <table style="border-collapse: collapse; width: 100%; max-width: 420px;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Reference</td>
          <td style="padding: 8px 0;">${safeReference}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Visit Date</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedDate)}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Time Slot</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedTimeSlot)}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Status</td>
          <td style="padding: 8px 0; color: #166534; font-weight: 600;">
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
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      <h2 style="margin: 0 0 12px; color: #991b1b;">
        Ocular Visit Cancelled
      </h2>

      <p style="margin: 0 0 12px;">
        Hi ${safeName},
      </p>

      <p style="margin: 0 0 16px;">
        Your ocular visit has been cancelled.
      </p>

      <table style="border-collapse: collapse; width: 100%; max-width: 420px;">
        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Reference</td>
          <td style="padding: 8px 0;">${safeReference}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Visit Date</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedDate)}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Time Slot</td>
          <td style="padding: 8px 0;">${escapeHtml(formattedTimeSlot)}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Reason</td>
          <td style="padding: 8px 0;">${safeReason}</td>
        </tr>

        <tr>
          <td style="padding: 8px 0; font-weight: 600;">Status</td>
          <td style="padding: 8px 0; color: #991b1b; font-weight: 600;">
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
