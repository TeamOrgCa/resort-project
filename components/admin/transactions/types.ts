export interface TransactionRow {
  transaction_id: string;
  reservation_id: string;
  total_amount: number;
  paid_amount: number | null;
  balance: number | null;
  overpaid_amount: number | null;
  status: "unpaid" | "partial" | "paid";
  created_at: string;
  updated_at: string;
}

export interface ReservationRow {
  reservation_id: string;
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
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
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
  status: "pending" | "confirmed" | "cancelled" | "completed" | null;
  start_datetime: string;
  end_datetime: string;
}

export interface InvoiceDetailTransactionRow {
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
  name: string;
  quantity: number;
  priceAtTime: number;
  lineTotal: number;
}

export interface InvoiceViewDetails {
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
}

export interface PaymentRow {
  payment_id: string;
  reservation_id: string;
  reference_number: string;
}

export interface ReceiptDetailReceiptRow {
  receipt_id: string;
  payment_id: string;
  receipt_number: string;
  issued_at: string;
  is_active: boolean | null;
  archived_at: string | null;
  amount_paid: number | null;
  transaction_total_at_time: number | null;
  balance_after_payment: number | null;
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
  reservation_id: string;
  guest_id: string | null;
  walk_in_guest_id?: string | null;
  reference_number: string;
  booking_type: "online" | "walk_in" | null;
  status: "pending" | "confirmed" | "cancelled" | "completed" | null;
  start_datetime: string;
  end_datetime: string;
}

export interface ReceiptDetailGuestRow {
  first_name: string | null;
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
}