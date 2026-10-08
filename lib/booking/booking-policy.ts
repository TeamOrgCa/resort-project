export interface BookingPolicy {
  version: number;
  cancellation_text: string;
  refund_text: string;
  refund_review_enabled: boolean;
  guest_cancellation_notice_hours: number;
  created_at: string;
}
