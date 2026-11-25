import type { DriveStep } from "driver.js";
import { DOWN_PAYMENT_PERCENT } from "@/lib/booking/payment-policy";

export type BookingGuidePage = "selection" | "dates" | "room" | "ocular" | "visit-scheduled" | "guest" | "review" | "payment" | "payment-complete";

const step = (target: string, title: string, description: string): DriveStep => ({
  element: `[data-booking-guide="${target}"]`,
  popover: { title, description, side: "bottom", align: "start" },
});

/** Only static copy goes into Driver's HTML-capable popovers. */
export function bookingGuide(page: BookingGuidePage, saved = false, balance = false, room = false, publicSwimming = false) {
  if (publicSwimming) return {
    title: "Public swimming booking guide",
    description: "Choose a public session, complete guest information, review and save, then submit full payment within 30 minutes.",
    steps: page === "dates" ? [
      step("public-times", "Choose Day or Night", "Choose an available Day or Night Public Swimming session. Read the Philippine times and entrance rates."),
      step("dates-calendar", "Choose a public date", "Browse any month and inspect both sessions. Each session shows its configured access mode, advance booking window and cutoff in Philippine time. Later dates show when booking opens; future availability is tentative because private reservations may still be made."),
      step("dates-continue", "Continue to guest details", "Enter adults, children, PWD/senior eligibility, optional services and a promo. Hourly services cannot exceed the session duration."),
    ] : page === "guest" ? [
      step("guest-personal", "Personal information", "Review the guest's name, phone number and address. Your signed-in account email is shown with your contact details."),
      step("guest-group", "Swimming guests", "Enter adults and children separately. Public entrance rates and the total update in the billing summary."),
      step("guest-services", "Optional services", "Choose any services you need. Hourly rentals cannot exceed your swimming session. Enter eligible PWD/senior guests and an optional promo in the discounts section below."),
      step("guest-requests", "Special requests", "Add any requests you would like the resort to review."),
      step("guest-summary", "Review your bill", "Check your session, adult and child admission, services, applicable discount and full payment amount."),
      step("guest-continue", "Review full details", "Continue to review the complete booking before saving. Full payment is due within 30 minutes after saving your reservation."),
    ] : page === "payment" ? [step("payment-amount", "Full payment", "Public swimming requires full payment of the outstanding balance. Submit payment within 30 minutes of saving. Payments awaiting review preserve the booking.")]
      : [step("review-summary", "Review public swimming details", "Check the public session, adults, children, services and the single applicable discount. Save the booking, then continue to full payment.")],
  };
  switch (page) {
    case "selection": return {
      title: "Choose your resort experience",
      description: "Start by choosing what you would like to book. Your calendar will appear after you select an option.",
      steps: [step("booking-type", "What would you like to book?", "Choose Private Swimming, Public Swimming, Ocular Visit or Room Accommodation. Use Back to booking options above the calendar to return to these cards.")],
    };
    case "dates": return {
      title: "Let's plan your resort booking",
      description: "Choose your dates, enter guest details, review and save, then pay. This tour explains this page. Close it anytime to make your selections; use Booking guide again on the next page.",
      steps: [
        step("booking-type", "Stay or a quick resort visit?", "Your selected booking option is shown above the calendar. Use Back to booking options to choose a different experience or schedule an ocular visit."),
        step("booking-mode", "Choose your package", "Select Day, Night or Whole-Day. Read the times shown for each package; Whole-Day has a choice of time slots. The selected package determines which dates are available."),
        step("dates-calendar", "Find an available date", "Use the arrows to change months, then select an available day. The legend explains selected dates, full bookings, maintenance closures and dates with only day or night availability. All schedules use Philippine time."),
        step("date-summary", "Check your schedule", "Check the start, end and package before continuing. Choosing a date here does not reserve it yet."),
        step("dates-continue", "Next: guest details", "Close the guide, choose an available date and continue to the reservation form. You will review everything before saving your booking."),
      ],
    };
    case "room": return {
      title: "Plan your room stay",
      description: "Choose a date, then select a 3-hour or 12-hour stay and an available check-in time below the calendar.",
      steps: [
        step("booking-type", "Room accommodation", "Use Back to booking options to choose a different resort experience."),
        step("dates-calendar", "Choose your check-in date", "Select an available date to see the room stay options below the calendar."),
        step("room-times", "Choose your stay and check-in time", "Select 3 hours or 12 hours, then choose a check-in time in 30-minute intervals, at least one hour in advance, subject to availability. Check-out is calculated from your selected duration and may be on the next day. Submit full payment within 30 minutes of saving; payments awaiting review keep your booking active. Times use Philippine time."),
        step("date-summary", "Review your room schedule", "Check your check-in, check-out and stay duration before continuing."),
        step("dates-continue", "Next: guest details", "Close the guide and continue to the reservation form after choosing your date and time."),
      ],
    };
    case "ocular": return {
      title: "Schedule a resort viewing",
      description: "An ocular visit is an optional visit to see the resort. It is separate from a stay reservation. This guide explains how to choose a visit date and time.",
      steps: [
        step("booking-type", "You're planning an ocular visit", "Use Back to booking options if you want to choose a swimming or room reservation instead."),
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
      description: room ? "Check your prefilled contact details, choose rooms and services, enter any PWD/senior count or promo, then review the booking. Room accommodation requires full payment." : "This is the guest-details step. Your earlier date and package are carried forward. Complete the required details, choose any extras, then review your booking.",
      steps: [
        step("guest-personal", "Who is the booking for?", "Check your name, email, Philippine mobile number and address. Use accurate contact details so the resort can reach you about the reservation."),
        step("guest-group", room ? "Rooms and guests" : "Guests and included cottages", room ? "Select the room type and guest count for each room. Use Add another room to include more rooms, subject to availability and capacity." : "Enter the number of guests attending. All cottages are included with private swimming. Read the guest limits and any extra-person charges shown below the field."),
        step("guest-services", "Optional resort services", "Select only the additional services you need. Their prices are added to the billing summary; leaving them unselected adds no service charge."),
        step("guest-requests", "Anything we should know?", "Use this optional field for special requests. The resort can review them with your booking."),
        step("guest-summary", "Watch your total", room ? "Review accommodation, additional guests, services and the single winning discount. Discounts never stack. Full payment is required for room accommodation." : `The summary shows your schedule, package, guest charges, extras and total. It also shows the ${DOWN_PAYMENT_PERCENT}% down payment option. Review the figures after changing your selections.`),
        step("guest-continue", "Review before saving", "Review Full Details opens the next step. It does not save a reservation or charge you. Missing required details will need to be completed first."),
      ],
    };
    case "review": return {
      title: saved ? "Your booking is saved" : "Review before you reserve",
      description: saved ? "Your reservation now has a reference. Check the payment deadline shown here and continue to payment to secure your booking." : "Check the guest details, schedule, services and bill. Your reservation is created only when you select Save Booking.",
      steps: [
        step("review-details", "Double-check your guest details", room ? "Review your name, contact details and address. Before saving, use Back to Booking Details to make corrections." : "Review the guest name and contact information. Before saving, use Back to Edit if you need to make a correction."),
        step("review-schedule", "Check the resort schedule", room ? "Check all selected rooms, guest counts, check-in, checkout and stay duration." : "Confirm the package, start and end times and group size before saving. All cottages are included with private swimming."),
        step("review-bill", "Understand the bill", room ? "Review the accommodation charges, services and the single applied discount. Room accommodation requires full payment after saving." : `Check the itemized total and the ${DOWN_PAYMENT_PERCENT}% down payment option. Payment is completed on the next page.`),
        step("review-policies", "Read the booking policies", "Read the cancellation and refund terms and confirm your agreement before saving. These terms are attached to your booking."),
        step("review-saved", "Keep your reference and deadline", "Keep the booking reference. Submit the required payment proof before the deadline displayed here so the booking does not expire."),
        step("review-actions", saved ? "Next: payment" : "Save when you're ready", saved ? "Continue to Payment opens the payment page for this saved reservation." : "Close the guide, accept the policies and select Save Booking. If asked, sign in first. Once saved, use Continue to Payment."),
      ],
    };
    case "payment": return {
      title: balance ? "Pay for your existing reservation" : "Secure your booking with payment",
      description: "Choose an available online payment method and submit proof for the saved reservation. Check the booking reference, receiving account and amount before transferring money. The tour itself makes no payment.",
      steps: [
        step("payment-amount", room ? "Pay the full balance" : "Choose the amount to pay", room ? "Room accommodation requires the full outstanding balance. Check the amount due before sending money. Payment remains subject to verification." : balance ? "Check the outstanding balance and any payment options available for this reservation. A payment awaiting review must be processed before another can be submitted." : `Choose the ${DOWN_PAYMENT_PERCENT}% down payment or full payment. Check the amount due before sending money.`),
        step("payment-sent", "Enter the exact amount sent", "Use the amount on your payment receipt. It must meet the minimum shown here; a larger verified payment reduces the remaining balance."),
        step("payment-account", "Check the receiving account", "Choose a method and verify the resort account details or QR code before transferring through your provider. Cash is collected at the resort. Reload the options if the receiving details are unavailable."),
        step("payment-sender", "Match the receipt details", "Enter the sender name, account identifier and complete provider reference from the receipt. GCash uses 8-20 numeric reference digits. Keep leading zeroes; do not use your booking reference as the payment reference."),
        step("payment-proof", "Upload the payment receipt", "Use the accepted image format and size shown here. Keep the amount, recipient, reference and date/time readable. GCash requires its original screenshot; other methods await cashier verification."),
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
