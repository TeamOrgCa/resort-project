import type { CustomerRoomSelection } from "./customer-rooms";

export function summarizeRoomSelections(rooms: CustomerRoomSelection[]) {
  const groups = new Map<string, { classificationId: string; name: string; quantity: number; guests: number }>();
  for (const room of rooms) {
    const group = groups.get(room.classificationId) ?? { classificationId: room.classificationId, name: room.name || "Room", quantity: 0, guests: 0 };
    group.quantity += 1;
    group.guests += room.occupants;
    groups.set(room.classificationId, group);
  }
  return [...groups.values()];
}

export const roomSelectionLabel = (rooms: CustomerRoomSelection[]) =>
  summarizeRoomSelections(rooms).map(room => `${room.name} × ${room.quantity}`).join(", ");
