import type { AdminTableColumn, AdminTableFilter, AdminTableSort } from "@/components/admin/types";
import type { ReportTab } from "./types";

type ReportConfig = { description: string; trendTitle: string; splitTitle: string; tableTitle: string; search: string; columns: AdminTableColumn[]; sort: AdminTableSort; filters?: AdminTableFilter[] };
export const reportConfig: Record<ReportTab, ReportConfig> = {
  "Sales Report": {
    description: "See received public-access collections and verified private-booking payments during the selected dates.", trendTitle: "Payments collected over time", splitTitle: "Collections by payment / access type", tableTitle: "Collections and bookings", search: "Search a date or amount…",
    columns: [{ key: "collectionSource", label: "Collection source" }, { key: "label", label: "Dates", sortType: "date", sortKey: "periodStart" }, { key: "revenue", label: "Payments collected", sortType: "number" }, {key:"publicRevenue",label:"Public access",sortType:"number"},{key:"privateRevenue",label:"Private booking",sortType:"number"},{ key: "payments", label: "Received payments", sortType: "number" },{key:"publicAdmissions",label:"Public access sales",sortType:"number"}, { key: "bookings", label: "Private reservations created", sortType: "number" }], sort: { key: "label", direction: "asc" },
  },
  "Guest Report": {
    description: "Find guests and reservations created during the selected dates, including offline bookings.", trendTitle: "Reservations created over time", splitTitle: "Booking sources", tableTitle: "Guest reservations", search: "Search guest name, contact or reservation reference…",
    columns: [{ key: "reference", label: "Reservation" }, { key: "guest", label: "Guest" }, { key: "phone", label: "Phone", sortType: "text" }, { key: "email", label: "Email", sortType: "text" }, { key: "source", label: "Booked through" }, { key: "status", label: "Status" }, { key: "guests", label: "Group size", sortType: "number" }, { key: "startAt", label: "Scheduled arrival (PH)", sortType: "date", sortKey: "startSort" }, { key: "createdAt", label: "Booked on (PH)", sortType: "date", sortKey: "createdSort" }, { key: "history", label: "Booking history" }], sort: { key: "createdAt", direction: "desc" },
    filters: [{ key: "source", label: "Booked through", options: ["Online booking", "Offline booking", "Unspecified"] }, { key: "status", label: "Status", options: ["Awaiting payment", "Payment under review", "Confirmed", "Completed", "Cancelled", "Expired", "Rejected", "Reschedule requested"] }, { key: "history", label: "Booking history", options: ["First-time booker", "Returning booker", "Profile unavailable"] }],
  },
  "Staff Report": {
    description: "Review logged actions by staff and other actors across resort modules.", trendTitle: "Logged activity over time", splitTitle: "Activity by module", tableTitle: "Activity by staff member", search: "Search staff member or recent action…",
    columns: [{ key: "staff", label: "Staff / actor" }, { key: "actions", label: "Logged actions", sortType: "number" }, { key: "latestAction", label: "Most recent action" }, { key: "lastActive", label: "Last activity (PH)", sortType: "date", sortKey: "lastActiveSort" }], sort: { key: "actions", direction: "desc" },
  },
};

// Human labels sort as text unless a numeric or raw-timestamp column is declared.
for (const config of Object.values(reportConfig)) config.columns = config.columns.map(column => ({ sortType: "text", ...column }));
