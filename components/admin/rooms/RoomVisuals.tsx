import type { Room, RoomIndicator } from "@/lib/rooms/types";
import { countdown, occupancyIndicator } from "@/lib/rooms/occupancy";

export function RoomIcon({ name = "bed", className = "h-5 w-5" }: { name?: string; className?: string }) {
  const paths: Record<string, string> = {
    bed: "M3 18v-9m18 9v-9M3 14h18M5 14V6h14v8M5 10h14M3 18h18M3 18v3m18-3v3",
    vacant: "M7 21V3h11v18M4 21h17M14 12h1", occupied: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m11-3v6m-3-3h6",
    cleaning: "m15 3-5 9m-4 0 7 4-4 6-7-4 4-6m0 4 5 3", maintenance: "m14 6 4 4 3-3a7 7 0 0 1-9 9l-6 6-4-4 6-6a7 7 0 0 1 9-9l-3 3",
    clock: "M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0", grid: "M3 3h7v7H3V3m11 0h7v7h-7V3M3 14h7v7H3v-7m11 0h7v7h-7v-7",
    list: "M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1", expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
    search: "M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0", check: "m5 12 4 4L19 6", refresh: "M20 8V3l-3 3a8 8 0 1 0 3 9M20 8h-5",
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true"><path d={paths[name] ?? paths.bed} /></svg>;
}
export const indicatorLabels: Record<RoomIndicator, string> = { vacant: "Vacant", occupied: "Occupied", cleaning: "Cleaning", maintenance: "Maintenance", expiring: "Expiring Soon", overdue: "Overdue" };
const colors: Record<RoomIndicator, string> = { vacant: "bg-green-100 text-green-800", occupied: "bg-orange-100 text-orange-900", cleaning: "bg-blue-100 text-blue-900", maintenance: "bg-red-100 text-red-800", expiring: "bg-amber-100 text-amber-900", overdue: "bg-red-100 text-red-800" };
export function RoomBadge({ indicator }: { indicator: RoomIndicator }) { return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${colors[indicator]}`}>{indicatorLabels[indicator]}</span>; }
export function RoomReadiness({ room, now, detailed = false }: { room: Room; now: number; detailed?: boolean }) {
  const indicator = occupancyIndicator(room, now);
  return <span className={`inline-flex items-center gap-1.5 text-sm ${["overdue", "expiring"].includes(indicator) ? "font-semibold text-red-700" : room.status === "vacant" ? "text-green-800" : "text-primary"}`}>
    <RoomIcon name={room.current ? "clock" : room.status === "vacant" ? "check" : room.status} className="h-4 w-4" />
    {room.current ? countdown(room.current.expected_checkout, now, detailed) : room.status === "vacant" ? "Ready for check-in" : room.status === "cleaning" ? "Housekeeping required" : "Unavailable for occupancy"}
  </span>;
}
