export type ReservedWindow = { start_datetime: string; end_datetime: string };

export function windowsOverlap(start: string, end: string, reserved: ReservedWindow): boolean {
  return new Date(start).getTime() < new Date(reserved.end_datetime).getTime()
    && new Date(end).getTime() > new Date(reserved.start_datetime).getTime();
}

export function isWindowAvailable(start: string, end: string, reservations: ReservedWindow[]): boolean {
  return !reservations.some((reservation) => windowsOverlap(start, end, reservation));
}
