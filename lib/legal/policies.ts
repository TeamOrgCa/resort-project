export type LegalSection = { heading: string; paragraphs?: string[]; items?: string[] };
export const LEGAL_POLICY_VERSION = "2026-10";

export const termsSections: LegalSection[] = [
  {
    heading: "1. Reservations and payment",
    paragraphs: [
      "A booking request is subject to availability. A reservation is saved when you submit it, and payment proof remains pending until resort staff verifies the actual transaction. A submitted screenshot or reference number does not by itself confirm payment.",
      "You may pay a 20% down payment or the full amount shown at checkout. Any remaining balance must be paid upon arrival before swimming. Keep your booking reference and payment confirmation for check-in.",
    ],
  },
  {
    heading: "2. Package rates and guest count",
    paragraphs: [
      "The displayed booking quote shows the applicable package rate, selected services, and additional guest charges. Packages include up to 20 guests; up to 10 additional guests may be added at the per-head rate shown at checkout, for a maximum of 30 guests in total. Adults and children both count toward this limit.",
      "The booking summary is the amount to review before saving. Ask the resort about holiday rates or special arrangements before paying if the displayed quote does not match your expected rate.",
    ],
  },
  {
    heading: "3. Changes and cancellation",
    paragraphs: [
      "Down payments are non-refundable if you cancel. Rescheduling is allowed with at least two weeks' notice during peak months (September to December and summer) or at least one week's notice during non-peak months, subject to an available date and resort confirmation.",
      "The resort's listed change fees are ₱50 for six days' notice, ₱100 for three days, ₱300 for one to two days, and ₱500 on or after the booked date. These shorter notice periods may fall outside the standard rescheduling window; contact the resort to ask whether an exception is available. Do not assume a new date is confirmed until staff approves it.",
    ],
  },
  {
    heading: "4. Included amenities and optional charges",
    paragraphs: [
      "The private pool package lists a cottage, two air-conditioned rooms with beds and private toilets, videoke, griller, parking, and the food inclusions shown in the booking offer. Availability and any selected add-ons appear in the booking summary.",
      "Listed optional charges include ₱200 corkage for outside food and drinks, additional rooms at the regular rate, extra mattress foam at ₱300, cooking from ₱150, swimming extension at ₱500 per hour per 20 guests, and an electricity charge for appliances. Confirm any optional charge and availability with staff before use.",
    ],
  },
  {
    heading: "5. Guest safety and conduct",
    paragraphs: [
      "Children should be accompanied by adults, especially near the pool. Follow lifeguard and staff instructions. Do not swim while intoxicated. Report hazards or emergencies to staff immediately. Fake or prank drowning may result in removal from the resort; emergency responders may be contacted when needed.",
      "Please keep personal belongings attended and report lost or damaged items promptly. Guests are responsible for their own conduct and for following posted resort rules. Nothing in these terms removes rights or responsibilities that cannot legally be excluded.",
    ],
  },
  {
    heading: "6. Contact",
    paragraphs: [
      "For a booking, payment, schedule change, or special arrangement, contact MarVille Resort Complex at emailmarvilleresort@gmail.com or 09172796592 / 82360633. The resort is at Cabrera Road, Hapay na Mangga, Brgy. Dolores, Taytay, Rizal 1920.",
    ],
  },
];

export const privacySections: LegalSection[] = [
  {
    heading: "1. Information we collect",
    paragraphs: ["When you create an account, book, pay, or contact us, we may collect:"],
    items: [
      "Name, email address, phone number, and address",
      "Account and authentication information",
      "Reservation dates, guest counts, selected packages, services, and requests",
      "Payment details and proof of payment, including information visible in an uploaded image",
      "Transaction history and messages sent to the resort",
    ],
  },
  {
    heading: "2. Why and how we use it",
    paragraphs: [
      "We use this information to create and manage reservations, check availability, verify payments, send confirmations and billing documents, assist guests, maintain accounts, prevent unauthorized activity, and keep operational and accounting records. We process information needed to provide the service you request and to meet applicable legal obligations. We do not use booking information for unrelated marketing without a separate basis.",
      "Passwords are handled by our authentication provider; the resort does not store them in plain text. We do not ask for or store your GCash password or PIN.",
    ],
  },
  {
    heading: "3. Who may receive it",
    paragraphs: [
      "Authorized resort administrators, managers, and cashiers may access information needed for their duties. Service providers supporting website hosting, authentication, database storage, email delivery, and payments may process the information needed to provide those services. Payment providers, including GCash when used, have their own privacy practices. We may disclose information when required by law or a lawful request. We do not sell or rent guest information.",
    ],
  },
  {
    heading: "4. Security and retention",
    paragraphs: [
      "We use access controls, authentication, and other reasonable safeguards to protect guest information. No electronic system can guarantee absolute security.",
      "We retain account, reservation, payment, and communication records while needed to provide services and meet operational, accounting, security, and legal requirements. When those purposes end, we take reasonable steps to delete, anonymize, or securely dispose of information, subject to any required retention. Contact us for details about the period applicable to your records.",
    ],
  },
  {
    heading: "5. Cookies and sessions",
    paragraphs: ["The website uses essential cookies or similar technology to maintain signed-in sessions, protect accounts, and provide core website functions."],
  },
  {
    heading: "6. Your rights",
    paragraphs: [
      "Under applicable Philippine data privacy law, you may ask to be informed about processing, access or correct your information, object to certain processing, and request erasure or blocking where allowed. You may also raise a privacy complaint with the National Privacy Commission. We may need to verify your identity and retain records where the law or an ongoing transaction requires it.",
    ],
  },
  {
    heading: "7. Updates and contact",
    paragraphs: [
      "We may update this policy when our services or practices change. The current version will be available on this website with its revision date.",
      "For privacy questions or requests, contact MarVille Resort Complex at emailmarvilleresort@gmail.com or 09172796592 / 82360633, or visit Cabrera Road, Hapay na Mangga, Brgy. Dolores, Taytay, Rizal 1920.",
    ],
  },
];
