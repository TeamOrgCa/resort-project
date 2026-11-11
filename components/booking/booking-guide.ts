import type { DriveStep } from "driver.js";
import { DOWN_PAYMENT_PERCENT } from "@/lib/booking/payment-policy";

export type BookingGuidePage = "dates" | "ocular" | "visit-scheduled" | "guest" | "review" | "payment" | "payment-complete";

const step = (target: string, title: string, description: string): DriveStep => ({
  element: `[data-booking-guide="${target}"]`,
  popover: { title, description, side: "bottom", align: "start" },
});

/** Only static copy goes into Driver's HTML-capable popovers. */
export function bookingGuide(page: BookingGuidePage, saved = false, balance = false) {
  switch (page) {
    case "dates": return {
      title: "Let's plan your resort booking",
      description: "Choose your dates, enter guest details, review and save, then pay. This tour explains this page. Close it anytime to make your selections; use Booking guide again on the next page.",
      steps: [
        step("booking-type", "Stay or a quick resort visit?", "Full Stay Booking starts a resort reservation. Ocular Visit lets you schedule a separate visit to see the facilities before booking a stay."),
        step("booking-mode", "Choose your package", "Select Day, Night or Whole-Day. Read the times shown for each package; Whole-Day has a choice of time slots. The selected package determines which dates are available."),
        step("dates-calendar", "Find an available date", "Use the arrows to change months, then select an available day. The legend explains selected dates, full bookings, maintenance closures and dates with only day or night availability. All schedules use Philippine time."),
        step("date-summary", "Check your schedule", "Check the start, end and package before continuing. Choosing a date here does not reserve it yet."),
        step("dates-continue", "Next: guest details", "Close the guide, choose an available date and continue to the reservation form. You will review everything before saving your booking."),
      ],
    };
    case "ocular": return {
      title: "Schedule a resort viewing",
      description: "An ocular visit is an optional visit to see the resort. It is separate from a stay reservation. This guide explains how to choose a visit date and time.",
      steps: [
        step("booking-type", "You're planning an ocular visit", "Use Full Stay Booking instead if you want to reserve a resort package."),
        step("dates-calendar", "Start with a visit date", "Choose an available date. The available time slots appear below the calendar after you select a day. Times use Philippine time."),
        step("ocular-times", "Choose a time slot", "Select one available time. Disabled slots are already reserved or too close to their start time."),
        step("date-summary", "Review your visit", "Check both the selected date and time. If time slots are not shown yet, close this guide and choose a date first."),
        step("ocular-submit", "Schedule when you're ready", "Close the guide and select Schedule Visit after choosing both a date and a time. Follow any sign-in prompt to complete the request."),
      ],
    };
    case "visit-scheduled": return {
      title: "Your visit has been scheduled",
      description: "Keep your visit reference and check the date and time shown here. An ocular visit does not reserve a stay package.",
      steps: [step("visit-confirmation", "Your visit details", "Keep this reference for follow-up. Check Manage Booking for your visit record and any updates.")],
    };
    case "guest": return {
      title: "Tell us about your group",
      description: "This is the guest-details step. Your earlier date and package are carried forward. Complete the required details, choose any extras, then review your booking.",
      steps: [
        step("guest-personal", "Who is the booking for?", "Check your name, email, Philippine mobile number and address. Use accurate contact details so the resort can reach you about the reservation."),
        step("guest-group", "Guests and unit selection", "Enter the adults and children attending and select an available unit. Read the guest limits and any extra-person charges shown below these fields."),
        step("guest-services", "Optional resort services", "Select only the additional services you need. Their prices are added to the billing summary; leaving them unselected adds no service charge."),
        step("guest-requests", "Anything we should know?", "Use this optional field for special requests. The resort can review them with your booking."),
        step("guest-summary", "Watch your total", `The summary shows your schedule, package, guest charges, extras and total. It also shows the ${DOWN_PAYMENT_PERCENT}% down payment option. Review the figures after changing your selections.`),
        step("guest-continue", "Review before saving", "Review Full Details opens the next step. It does not save a reservation or charge you. Missing required details will need to be completed first."),
      ],
    };
    case "review": return {
      title: saved ? "Your booking is saved" : "Review before you reserve",
      description: saved ? "Your reservation now has a reference. Check the payment deadline shown here and continue to payment to secure your booking." : "Check the guest details, schedule, services and bill. Your reservation is created only when you select Save Booking.",
      steps: [
        step("review-details", "Double-check your guest details", "Review the guest name and contact information. Before saving, use Back to Edit if you need to make a correction."),
        step("review-schedule", "Check the resort schedule", "Confirm the package, start and end times, unit and group size before saving."),
        step("review-bill", "Understand the bill", `Check the itemized total and the ${DOWN_PAYMENT_PERCENT}% down payment option. Payment is completed on the next page.`),
        step("review-policies", "Read the booking policies", "Read the cancellation and refund terms and confirm your agreement before saving. These terms are attached to your booking."),
        step("review-saved", "Keep your reference and deadline", "Keep the booking reference. Submit the required payment proof before the deadline displayed here so the booking does not expire."),
        step("review-actions", saved ? "Next: payment" : "Save when you're ready", saved ? "Continue to Payment opens the payment page for this saved reservation." : "Close the guide, accept the policies and select Save Booking. If asked, sign in first. Once saved, use Continue to Payment."),
      ],
    };
    case "payment": return {
      title: balance ? "Pay for your existing reservation" : "Secure your booking with payment",
      description: "This page records your GCash payment and proof for the saved reservation. Check the booking reference and amount before transferring money. The tour itself makes no payment.",
      steps: [
        step("payment-amount", "Choose the amount to pay", balance ? "Check the outstanding balance and any payment options available for this reservation. A payment awaiting review must be processed before another can be submitted." : `Choose the ${DOWN_PAYMENT_PERCENT}% down payment or full payment. Check the amount due before sending money.`),
        step("payment-sent", "Enter the exact amount sent", "Use the amount on your GCash receipt. It must meet the minimum shown here; a larger verified payment reduces the remaining balance."),
        step("payment-account", "Check the receiving account", "Choose a provider and verify its account details and QR code before transferring in GCash. If the QR code is unavailable, use the reload option before sending payment."),
        step("payment-sender", "Match the receipt details", "Enter the sender name, your account number and the complete numeric GCash reference from the receipt. Keep leading zeroes; do not use your booking reference as the payment reference."),
        step("payment-proof", "Upload the original screenshot", "Upload the original GCash receipt screenshot in an accepted format and size shown here. Keep the amount, recipient, reference and payment date/time clear and readable."),
        step("payment-policies", "Read and agree", "Review the policy agreement and confirm it before submitting your payment details."),
        step("payment-submit", "Submit once, then check the result", "Confirm Payment submits the details and proof. Follow the resulting status message; uploading proof alone does not mean the reservation is confirmed. Use Manage Booking to follow the payment status."),
      ],
    };
    case "payment-complete": return {
      title: "Check your payment result",
      description: "Read the status at the top of this page to see whether your payment was approved or is awaiting review. Keep your booking reference for follow-up.",
      steps: [
        step("payment-result", "Your reservation summary", "Check the recorded reservation and payment amounts. A submitted payment can still need review; use the displayed status as your confirmation."),
        step("payment-manage", "Follow your booking", "Open Manage Booking to see current payment records, receipts and available reservation actions."),
      ],
    };
  }
}
