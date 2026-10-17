export type ReservationRecord = {
  reservation_id: string; reference_number: string; guest_id: string | null; walk_in_guest_id: string | null;
  start_datetime: string; end_datetime: string; booking_mode: string | null; booking_type: string | null;
  adult_count: number; child_count: number; status: string; special_requests: string | null;
  created_at: string; checked_in_at: string | null; checked_out_at: string | null;
};
export type ReservationRecordDetail = {
  reservation: ReservationRecord;
  guest: { first_name: string; last_name: string; email: string | null; phone_number: string | null; address: string | null } | null;
  units: { name: string; quantity: number; price: number }[];
  services: { name: string; quantity: number; price: number }[];
  bill: { total: number; paid: number; balance: number; status: string } | null;
};
