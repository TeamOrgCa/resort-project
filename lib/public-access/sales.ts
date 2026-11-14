import { normalizePersonName, PERSON_NAME_ERROR } from "@/lib/validation/name";
import { normalizePhilippineMobile, PH_MOBILE_ERROR } from "@/lib/validation/phone";
import { isValidPaymentAmount } from "@/lib/booking/payment-policy";

export const PUBLIC_ACCESS_TYPES = { swimming: "Public swimming", cottage: "Cottage usage", room: "Room usage", mixed: "Mixed public access" } as const;
export type PublicAccessType = keyof typeof PUBLIC_ACCESS_TYPES;
export type SalesSource = "all" | "public" | "private";
export const SALES_SOURCES = { all: "All collections", public: "Public access", private: "Private booking" } as const;
export type PublicAccessSale = {
  sale_id: string; reference_number: string; receipt_number: string; guest_name: string; contact_number: string;
  access_type: PublicAccessType; payment_for: string; amount: number; payment_method_id: string; payment_method_name: string;
  payment_reference: string; proof_path: string | null; cashier_id: string; paid_at: string;
};
export type PublicAccessInput = { requestId: string; guestName: string; contactNumber: string; accessType: PublicAccessType;
  paymentFor: string; amount: number; paymentMethodId: string; paymentReference?: string; proofPath?: string; fundsReceived: boolean };
export const PUBLIC_SALE_COLUMNS = "sale_id,reference_number,receipt_number,guest_name,contact_number,access_type,payment_for,amount,payment_method_id,payment_method_name,payment_reference,proof_path,cashier_id,paid_at";
export const uuid = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);

export function validatePublicAccessInput(body: unknown): { value?: PublicAccessInput; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Enter valid admission details." };
  const input = body as PublicAccessInput;
  const guestName = normalizePersonName(input.guestName), contactNumber = normalizePhilippineMobile(input.contactNumber);
  if (!guestName) return { error: PERSON_NAME_ERROR };
  if (!contactNumber) return { error: PH_MOBILE_ERROR };
  if (!uuid(input.requestId) || !uuid(input.paymentMethodId)) return { error: "Choose an available payment method and retry this admission form." };
  if (!Object.hasOwn(PUBLIC_ACCESS_TYPES, input.accessType)) return { error: "Choose public swimming, cottage, room or mixed usage." };
  if (typeof input.paymentFor !== "string" || input.paymentFor.trim().length < 3 || input.paymentFor.trim().length > 2000) return { error: "Describe what the payment covers using 3–2,000 characters." };
  if (typeof input.amount !== "number" || !isValidPaymentAmount(input.amount)) return { error: "Enter a valid amount received, with at most two decimal places." };
  if (input.fundsReceived !== true) return { error: "Confirm that the resort has received this payment." };
  return { value: { ...input, guestName, contactNumber, paymentFor: input.paymentFor.trim() } };
}
