export type RoomStatus = "vacant" | "occupied" | "cleaning" | "maintenance";
export type RoomIndicator = RoomStatus | "expiring" | "overdue";
export type RoomClass = {
  classification_id: string; name: string; code: string; included_capacity: number; maximum_capacity: number;
  base_rate: number; base_hours: number; additional_guest_rate: number; extension_hourly_rate: number; cleaning_buffer_minutes: number;
  rate_3_hours: number; rate_8_hours?: number | null; rate_12_hours: number; pricing_version: number;
};
export type RoomAssignment = {
  assignment_id: string; room_id: string; reservation_id: string; occupants: number;
  starts_at: string; expected_checkout: string; checked_in_at: string | null; checked_out_at: string | null;
  state: "reserved" | "occupied" | "completed" | "cancelled" | "transferred";
  reservation: { reference_number: string; commercial_type: string; room_pricing?: boolean; status: string; start_datetime: string; end_datetime: string };
  guest_name: string; contact: string;
};
export type RoomActivity = {
  activity_id: string; room_id: string; reservation_id: string | null; reference_number: string | null;
  activity_type: string; description: string; created_at: string; staff_name: string;
};
export type Room = {
  private_swimming_only?: boolean;
  room_id: string; room_number: string; name: string; classification_id: string; status: RoomStatus;
  is_active: boolean; condition_notes: string | null; classification: RoomClass;
  current: RoomAssignment | null; upcoming: RoomAssignment[];
  maintenance: { maintenance_id: string; starts_at: string; ends_at: string; reason: string; completed_at: string | null }[];
};
export type RoomBill = {
  total_amount: number; paid_amount: number; balance: number; status: string; discount_amount: number;
  charges: { charge_id: string; kind: string; description: string; amount: number; room_id: string }[];
  services: { name: string; amount: number }[];
};
export type RoomDashboard = { rooms: Room[]; classifications: RoomClass[]; updated_at: string; server_now: string };
