export interface TransactionRow {
  reservation_status?: string;
  transaction_id: string;
  reservation_id: string;
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
  overpaid_amount: number | null;
  status: "unpaid" | "partial" | "paid" | "cancelled"; // Cancelled is a ledger display state, not a stored transaction status.
  created_at: string;
  updated_at: string;
}

export interface ReservationRow {
  commercial_type?: string;
  reservation_id: string;
  guest_id?: string | null;
  walk_in_guest_id?: string | null;
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
  status?: string;
}

export interface InvoiceRow {
  invoice_id: string;
  reservation_id: string;
  total_amount: number;
  created_at: string;
}

export interface InvoiceDetailInvoiceRow {
  invoice_id: string;
  reservation_id: string;
  total_amount: number;
  created_at: string;
}

export interface InvoiceDetailReservationRow {
  commercial_type?: string;
  public_pricing_snapshot?: { adult_rate: number; child_rate: number } | null;
  booking_mode?: string | null;
  adult_count?: number;
  child_count?: number;
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show" | null;
  start_datetime: string;
  end_datetime: string;
}

export interface InvoiceDetailTransactionRow {
  discount_promo_code?: string | null;
  discount_promo_type?: "percent" | "fixed" | null;
  discount_promo_value?: number;
  discount_eligible_guests?: number;
  discount_package_price?: number;
  discount_amount?: number;
  discount_kind?: string;
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
  status: "unpaid" | "partial" | "paid";
}

export interface InvoiceDetailPaymentRow {
  payment_id: string;
  reference_number: string;
  amount: number;
  status: "pending" | "verified";
  paid_at: string | null;
}

export interface InvoiceDetailReceiptRow {
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  is_active: boolean | null;
  archived_at: string | null;
}

export interface InvoiceDetailReservationUnitRow {
  quantity: number;
  price_per_night: number;
  units:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

export interface InvoiceDetailReservationServiceRow {
  billing_type?: "quantity" | "duration" | "person" | "fixed";
  quantity: number;
  price_at_time: number;
  services:
    | {
        name: string;
      }
    | Array<{
        name: string;
      }>
    | null;
}

export interface InvoiceUnitBreakdownItem {
  name: string;
  quantity: number;
  pricePerNight: number;
  lineTotal: number;
}

export interface InvoiceServiceBreakdownItem {
  billingType?: "quantity" | "duration" | "person" | "fixed";
  name: string;
  quantity: number;
  priceAtTime: number;
  lineTotal: number;
}

export interface InvoiceViewDetails {
  roomCharges?: { description: string; amount: number }[];
  invoice: InvoiceDetailInvoiceRow;
  reservation: InvoiceDetailReservationRow | null;
  transaction: InvoiceDetailTransactionRow | null;
  verifiedPayments: InvoiceDetailPaymentRow[];
  latestReceipt: InvoiceDetailReceiptRow | null;
  nights: number;
  unitBreakdown: InvoiceUnitBreakdownItem[];
  serviceBreakdown: InvoiceServiceBreakdownItem[];
  unitsSubtotal: number;
  servicesSubtotal: number;
  computedTotal: number;
}

export interface ReceiptRow {
  receipt_id: string;
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  is_active: boolean | null;
  archived_at: string | null;
  billed_to_name: string | null;
}

export interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  reference_number: string;
}

export interface ReceiptDetailReceiptRow {
  discount_snapshot?: import("@/lib/booking/billing-discount").BillingDiscountSnapshot | null;
  receipt_id: string;
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  is_active: boolean | null;
  archived_at: string | null;
  amount_paid: number | null;
  transaction_total_at_time: number | null;
  balance_after_payment: number | null;
  billed_to_name: string | null;
}

export interface ReceiptDetailPaymentRow {
  payment_id: string;
  reservation_id: string;
  reference_number: string;
  amount: number;
  payment_method_id: string | null;
  payment_type: "downpayment" | "full" | "additional";
  status: "pending" | "verified";
  paid_at: string | null;
  account_name: string;
  account_number: string | null;
  proof_path: string;
}

export interface ReceiptDetailReservationRow {
  commercial_type?: string;
  reservation_id: string;
  guest_id: string | null;
  walk_in_guest_id?: string | null;
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
  booking_mode?: string | null;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show" | null;
  start_datetime: string;
  end_datetime: string;
}

export interface ReceiptDetailGuestRow {
  first_name: string | null;
  middle_name?: string | null;
  last_name: string | null;
  email: string;
}

export interface ReceiptDetailTransactionRow {
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
  overpaid_amount: number | null;
  status: "unpaid" | "partial" | "paid";
}

export interface ViewField {
  label: string;
  value: string;
}

export interface ViewDetailsState {
  title: string;
  fields: ViewField[];
  transactionId?: string;
  kind?: "receipt";
  printOnOpen?: boolean;
}
