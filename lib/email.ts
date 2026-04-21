import nodemailer from "nodemailer";

interface ReservationEmailBase {
  guestEmail: string;
  guestName: string;
  reservationReference: string;
  checkInDate?: string | null;
  checkOutDate?: string | null;
}

interface ReservationCancelledEmailPayload extends ReservationEmailBase {
  cancellationReason: string;
}

const appName = process.env.EMAIL_APP_NAME ?? "Resort Project";
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

export const sendReservationConfirmedEmail = async ({
  guestEmail,
  guestName,
  reservationReference,
  checkInDate,
  checkOutDate,
}: ReservationEmailBase) => {
  const safeName = escapeHtml(guestName || "Guest");
  const safeReference = escapeHtml(reservationReference);
  const formattedCheckIn = formatDateLabel(checkInDate);
  const formattedCheckOut = formatDateLabel(checkOutDate);
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