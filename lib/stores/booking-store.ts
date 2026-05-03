import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface BookingServiceItem {
  id: string;
  name: string;
  price: number;
}

export interface BookingDraft {
  checkIn: string;
  checkOut: string;
  bookingMode: "day" | "night" | "whole_day" | "custom";
  startDatetime: string;
  endDatetime: string;
  wholeDayVariant: "day_to_night" | "night_to_day";
  customStartTime: string;
  customEndTime: string;
  customEndDate: string;
  customDurationHours: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  adultCount: number;
  childCount: number;
  unitId: string;
  roomName: string;
  roomPrice: number;
  nights: number;
  subtotal: number;
  tax: number;
  total: number;
  downPayment: number;
  services: BookingServiceItem[];
  specialRequests: string;
  reservationId: string;
  reservationReference: string;
}

interface BookingStoreState {
  bookingDraft: BookingDraft;
  setBookingDates: (checkIn: string, checkOut: string) => void;
  setBookingWindow: (
    bookingMode: BookingDraft["bookingMode"],
    startDatetime: string,
    endDatetime: string,
    options?: {
      wholeDayVariant?: BookingDraft["wholeDayVariant"];
      customStartTime?: string;
      customEndTime?: string;
      customEndDate?: string;
      customDurationHours?: number;
    }
  ) => void;
  setBookingDraft: (draft: Partial<BookingDraft>) => void;
  clearReservationMetadata: () => void;
  resetBookingDraft: () => void;
}

const initialDraft: BookingDraft = {
  checkIn: "",
  checkOut: "",
  bookingMode: "day",
  startDatetime: "",
  endDatetime: "",
  wholeDayVariant: "day_to_night",
  customStartTime: "08:00",
  customEndTime: "11:00",
  customEndDate: "",
  customDurationHours: 0,
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  adultCount: 1,
  childCount: 0,
  unitId: "",
  roomName: "",
  roomPrice: 0,
  nights: 1,
  subtotal: 0,
  tax: 0,
  total: 0,
  downPayment: 0,
  services: [],
  specialRequests: "",
  reservationId: "",
  reservationReference: "",
};

export const useBookingStore = create<BookingStoreState>()(
  persist(
    (set) => ({
      bookingDraft: initialDraft,
      setBookingDates: (checkIn, checkOut) =>
        set((state) => ({
          bookingDraft: {
            ...state.bookingDraft,
            checkIn,
            checkOut,
          },
        })),
      setBookingWindow: (bookingMode, startDatetime, endDatetime, options) =>
        set((state) => ({
          bookingDraft: {
            ...state.bookingDraft,
            bookingMode,
            startDatetime,
            endDatetime,
            wholeDayVariant: options?.wholeDayVariant ?? state.bookingDraft.wholeDayVariant,
            customStartTime: options?.customStartTime ?? state.bookingDraft.customStartTime,
            customEndTime: options?.customEndTime ?? state.bookingDraft.customEndTime,
            customEndDate: options?.customEndDate ?? state.bookingDraft.customEndDate,
            customDurationHours: options?.customDurationHours ?? state.bookingDraft.customDurationHours,
            checkIn: startDatetime ? startDatetime.slice(0, 10) : state.bookingDraft.checkIn,
            checkOut: endDatetime ? endDatetime.slice(0, 10) : state.bookingDraft.checkOut,
          },
        })),
      setBookingDraft: (draft) =>
        set((state) => ({
          bookingDraft: {
            ...state.bookingDraft,
            ...draft,
          },
        })),
      clearReservationMetadata: () =>
        set((state) => ({
          bookingDraft: {
            ...state.bookingDraft,
            reservationId: "",
            reservationReference: "",
          },
        })),
      resetBookingDraft: () =>
        set({
          bookingDraft: initialDraft,
        }),
    }),
    {
      name: "booking-draft-store",
      storage: createJSONStorage(() => sessionStorage),
    }
  )
);
