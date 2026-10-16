export type GuestReservationHistoryRow = {
  id: string; reference: string; status: string; bookingMode: string | null;
  startDatetime: string; endDatetime: string; createdAt: string;
  adults: number; children: number; checkedInAt: string | null; checkedOutAt: string | null;
  totalAmount: number | null; paidAmount: number | null; balance: number | null;
};

export const GUEST_HISTORY_PAGE_SIZE = 20;
