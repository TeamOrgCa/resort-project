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
  });
};

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
