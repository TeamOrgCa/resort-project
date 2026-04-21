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
}

interface BookingStoreState {
  bookingDraft: BookingDraft;
  setBookingDates: (checkIn: string, checkOut: string) => void;
  setBookingDraft: (draft: Partial<BookingDraft>) => void;
  resetBookingDraft: () => void;
}

const initialDraft: BookingDraft = {
  checkIn: "",
  checkOut: "",
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
      setBookingDraft: (draft) =>
        set((state) => ({
          bookingDraft: {
            ...state.bookingDraft,
            ...draft,
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
