import type { AdminTableRow } from "@/components/admin/types";
import type { Permission } from "@/lib/auth/role-access";

export type DashboardSnapshot = {
  generatedAt: string;
  today: string;
  arrivalEndDate: string;
  startDate: string;
  endDate: string;
  permissions: Permission[];
  arrivalsToday: number;
  scheduledNow: number;
  collectionsToday: number;
  verifiedToday: number;
  collections: { label: string; value: number }[];
  bookingStatuses: { label: string; value: number }[];
  bookingSources: { label: string; value: number }[];
  bookingsCreated: number;
  queues: { payments: number; reschedules: number; ocular: number; refundReview: number; refundPayout: number };
  reservations: AdminTableRow[];
};
