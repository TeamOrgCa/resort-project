export type BookingMode = "day" | "night" | "whole_day" | "custom";
export type WholeDayVariant = "day_to_night" | "night_to_day";

export interface BookingWindowInput {
  bookingMode: BookingMode;
  startDatetime: string;
  endDatetime: string;
  wholeDayVariant?: WholeDayVariant | null;
  customStartTime?: string | null;
  customEndTime?: string | null;
}

export interface BookingWindowValidationResult {
  valid: boolean;
  message?: string;
  durationHours: number;
}

export const CUSTOM_START_HOUR = 8;
export const CUSTOM_END_HOUR = 22;
export const CUSTOM_MIN_DURATION_HOURS = 3;

const HOURS_BY_MODE: Record<Exclude<BookingMode, "custom">, number> = {
  day: 8,
  night: 12,
  whole_day: 22,
};

const round2 = (value: number) => Math.round(value * 100) / 100;

const parseClock = (value: string | null | undefined) => {
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length !== 2) return null;

  const hour = Number(parts[0]);
  const minute = Number(parts[1]);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return { hour, minute, minutesOfDay: hour * 60 + minute };
};

export const validateBookingWindow = (input: BookingWindowInput): BookingWindowValidationResult => {
  const start = new Date(input.startDatetime);
  const end = new Date(input.endDatetime);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { valid: false, message: "Invalid booking datetime values.", durationHours: 0 };
  }

  const durationHours = round2((end.getTime() - start.getTime()) / (1000 * 60 * 60));

  if (durationHours <= 0) {
    return { valid: false, message: "End datetime must be after start datetime.", durationHours };
  }

  if (input.bookingMode === "custom") {
    if (durationHours < CUSTOM_MIN_DURATION_HOURS) {
      return {
        valid: false,
        message: `Custom bookings require at least ${CUSTOM_MIN_DURATION_HOURS} hours.`,
        durationHours,
      };
    }

    const startClock = parseClock(input.customStartTime);
    const endClock = parseClock(input.customEndTime);

    if (!startClock || !endClock) {
      return {
        valid: false,
        message: "Custom bookings must provide a valid start and end time.",
        durationHours,
      };
    }

    const openingMinutes = CUSTOM_START_HOUR * 60;
    const closingMinutes = CUSTOM_END_HOUR * 60;

    if (startClock.minutesOfDay < openingMinutes || endClock.minutesOfDay > closingMinutes) {
      return {
        valid: false,
        message: "Custom bookings must be within 8:00 AM to 10:00 PM.",
        durationHours,
      };
    }

    const sameDay =
      start.getFullYear() === end.getFullYear() &&
      start.getMonth() === end.getMonth() &&
      start.getDate() === end.getDate();

    if (sameDay && endClock.minutesOfDay <= startClock.minutesOfDay) {
      return {
        valid: false,
        message: "For same-day custom bookings, end time must be after start time.",
        durationHours,
      };
    }

    return { valid: true, durationHours };
  }

  const expected = HOURS_BY_MODE[input.bookingMode];
  if (Math.abs(durationHours - expected) > 0.01) {
    return {
      valid: false,
      message: `Invalid ${input.bookingMode.replace("_", " ")} booking window.`,
      durationHours,
    };
  }

  if (input.bookingMode === "whole_day" && !input.wholeDayVariant) {
    return {
      valid: false,
      message: "Whole-day bookings must specify the whole-day variant.",
      durationHours,
    };
  }

  return { valid: true, durationHours };
};

export const toIsoLocalDay = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const atTime = (date: Date, hour: number, minute = 0) => {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
};

export interface BuildBookingWindowInput {
  bookingMode: BookingMode;
  date: Date;
  wholeDayVariant?: WholeDayVariant;
  customStartTime?: string;
  customEndTime?: string;
  customEndDate?: Date;
}

export const buildBookingWindow = (input: BuildBookingWindowInput) => {
  let start: Date;
  let end: Date;

  if (input.bookingMode === "day") {
    start = atTime(input.date, 8);
    end = atTime(input.date, 16);
  } else if (input.bookingMode === "night") {
    start = atTime(input.date, 18);
    end = atTime(input.date, 6);
    end.setDate(end.getDate() + 1);
  } else if (input.bookingMode === "whole_day") {
    const variant = input.wholeDayVariant ?? "day_to_night";
    if (variant === "day_to_night") {
      start = atTime(input.date, 8);
      end = atTime(input.date, 6);
      end.setDate(end.getDate() + 1);
    } else {
      start = atTime(input.date, 18);
      end = atTime(input.date, 16);
      end.setDate(end.getDate() + 1);
    }
  } else {
    const startClock = parseClock(input.customStartTime ?? null);
    const endClock = parseClock(input.customEndTime ?? null);

    if (!startClock || !endClock) {
      return { error: "Please select a valid custom start and end time." };
    }

    const endDate = input.customEndDate ?? input.date;
    start = atTime(input.date, startClock.hour, startClock.minute);
    end = atTime(endDate, endClock.hour, endClock.minute);
  }

  return {
    startDatetime: start.toISOString(),
    endDatetime: end.toISOString(),
    checkIn: toIsoLocalDay(start),
    checkOut: toIsoLocalDay(end),
    customDurationHours: round2((end.getTime() - start.getTime()) / (1000 * 60 * 60)),
  };
};
