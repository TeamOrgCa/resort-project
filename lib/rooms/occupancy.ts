import type { Room, RoomIndicator } from "./types";

export function occupancyIndicator(room: Pick<Room, "status" | "current">, now: number): RoomIndicator {
  if (room.status !== "occupied" || !room.current) return room.status;
  const remaining = Date.parse(room.current.expected_checkout) - now;
  return remaining < 0 ? "overdue" : remaining <= 30 * 60_000 ? "expiring" : "occupied";
}
export function countdown(checkout: string, now: number, detailed = false): string {
  const delta = Date.parse(checkout) - now;
  if (!Number.isFinite(delta)) return "Checkout unavailable";
  const seconds = Math.max(0, Math.ceil(Math.abs(delta) / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  const time = detailed ? [hours, minutes, seconds % 60].map(n => String(n).padStart(2, "0")).join(":") : `${hours ? `${hours}h ` : ""}${minutes}m`;
  return delta < 0 ? `Overdue by ${time}` : `${time} left`;
}
export function roomMatches(room: Room, query: string, status: string, now: number): boolean {
  const text = [room.room_number, room.name, room.classification.name, ...[room.current, ...room.upcoming].flatMap(a => a ? [a.guest_name, a.reservation.reference_number, a.assignment_id] : [])].join(" ").toLowerCase();
  return text.includes(query.trim().toLowerCase()) && (status === "all" || room.status === status || occupancyIndicator(room, now) === status);
}
export const roomDate = (value: string | null | undefined) => value ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
export const roomMoney = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
