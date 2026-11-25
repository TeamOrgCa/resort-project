import type { Room } from "@/lib/rooms/types";
import { occupancyIndicator, roomDate } from "@/lib/rooms/occupancy";
import { RoomBadge, RoomIcon, RoomReadiness } from "./RoomVisuals";

export default function RoomGrid({ rooms, now, expanded, onSelect }: {
  rooms: Room[];
  now: number;
  expanded: boolean;
  onSelect: (room: Room) => void;
}) {
  return (
    <div className={`grid items-stretch gap-3 ${expanded
      ? "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
      : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5"}`}>
      {rooms.map(room => (
        <button
          key={room.room_id}
          type="button"
          aria-label={`Room ${room.room_number} details`}
          onClick={() => onSelect(room)}
          className={`group flex h-full min-w-0 flex-col rounded-xl border border-neutral/10 bg-white p-4 text-left shadow-sm transition-colors hover:border-primary/50 hover:bg-base/50 ${expanded ? "min-h-56" : "min-h-48"}`}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <span className="min-w-0 truncate font-semibold text-neutral" title={room.room_number}>{room.room_number}</span>
            <RoomBadge indicator={occupancyIndicator(room, now)} />
          </div>
          <p className="mt-1 text-xs text-neutral/60">{room.classification.name}</p>
          {room.private_swimming_only && <p className="mt-2 text-xs font-semibold text-primary">Private swimming package only</p>}

          <div className="my-4 min-w-0 space-y-2 text-sm">
            {room.current ? (
              <>
                <p className="flex min-w-0 items-center gap-2 font-medium">
                  <RoomIcon name="occupied" className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate" title={room.current.guest_name}>{room.current.guest_name}</span>
                </p>
                <p className="text-neutral/70">{room.current.occupants} occupants</p>
                <p className="text-xs text-neutral/60">Included: {room.classification.included_capacity} pax · Max: {room.classification.maximum_capacity} pax</p>
              </>
            ) : (
              <>
                <p className="flex items-center gap-2 text-neutral/70"><RoomIcon name="bed" className="h-4 w-4 text-primary" />Included: {room.classification.included_capacity} pax</p>
                <p className="text-neutral/70">Maximum: {room.classification.maximum_capacity} pax</p>
              </>
            )}
          </div>

          <div className="mt-auto min-w-0 border-t border-neutral/10 pt-3">
            <RoomReadiness room={room} now={now} />
            {room.upcoming.length > 0 && <p className="mt-2 truncate text-xs text-neutral/60" title={`Next reservation: ${roomDate(room.upcoming[0].starts_at)}`}>Next: {roomDate(room.upcoming[0].starts_at)}</p>}
          </div>
        </button>
      ))}
    </div>
  );
}
