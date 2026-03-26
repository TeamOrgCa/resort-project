import type {
  AdminFeatureCard,
  AdminMetric,
  AdminNavItem,
  AdminTableColumn,
  AdminTableRow,
} from "@/components/admin/types";

export const adminNavigation: AdminNavItem[] = [
  { label: "Dashboard", href: "/admin", description: "Operational overview" },
  { label: "Reservations", href: "/admin/reservations", description: "Booking and approvals" },
  { label: "Schedules", href: "/admin/schedules", description: "Date blocks and events" },
  { label: "Transactions", href: "/admin/transactions", description: "Billing and invoicing" },
  { label: "Reports", href: "/admin/reports", description: "Sales and operations reports" },
  { label: "Analytics", href: "/admin/analytics", description: "Forecasting insights" },
  { label: "Users", href: "/admin/users", description: "Roles and permissions" },
  { label: "Audit Log", href: "/admin/audit", description: "Staff activity tracking" },
];

export const dashboardMetrics: AdminMetric[] = [
  { label: "Total Bookings", value: "124", trend: "+8% this week" },
  { label: "Upcoming Reservations", value: "37", trend: "Next 7 days" },
  { label: "Occupancy Status", value: "82%", trend: "Current utilization" },
  { label: "Daily Revenue", value: "₱128,400", trend: "+5.2% vs yesterday" },
  { label: "Pending Transactions", value: "14", trend: "Needs verification" },
];

export const dashboardModules: AdminFeatureCard[] = [
  {
    title: "Reservation and Booking Management",
    summary: "View and manage website and walk-in bookings in one centralized flow.",
    href: "/admin/reservations",
  },
  {
    title: "Reservation Confirmation and Approval",
    summary: "Verify down payments and confirm reservations to finalize booking records.",
    href: "/admin/reservations",
  },
  {
    title: "Manual Booking Entry",
    summary: "Encode offline and walk-in reservations for complete operational records.",
    href: "/admin/reservations",
  },
  {
    title: "Schedule Management",
    summary: "Block dates for maintenance and private events to avoid booking overlaps.",
    href: "/admin/schedules",
  },
  {
    title: "Transaction and Billing",
    summary: "Track totals, balances, and outstanding amounts in a POS-like workflow.",
    href: "/admin/transactions",
  },
  {
    title: "Audit Log",
    summary: "Monitor staff activities with chronological records of system actions.",
    href: "/admin/audit",
  },
];

export const upcomingReservationsColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" },
  { key: "guest", label: "Guest" },
  { key: "checkIn", label: "Check-in" },
  { key: "checkOut", label: "Check-out" },
  { key: "status", label: "Status" },
];

export const upcomingReservationsRows: AdminTableRow[] = [
  {
    id: "1",
    reference: "MV-2026-0132",
    guest: "Isabelle Cruz",
    checkIn: "2026-03-28",
    checkOut: "2026-03-30",
    status: "Confirmed",
  },
  {
    id: "2",
    reference: "MV-2026-0136",
    guest: "Marco Santos",
    checkIn: "2026-03-29",
    checkOut: "2026-04-01",
    status: "Pending",
  },
  {
    id: "3",
    reference: "MV-2026-0141",
    guest: "Alyanna Reyes",
    checkIn: "2026-03-31",
    checkOut: "2026-04-02",
    status: "Confirmed",
  },
];

export const reservationProcessStages = [
  "Date selection from client booking calendar",
  "Reservation form submission with guest and amenity details",
  "Down payment request and payment form completion",
  "Payment verification by staff and reservation approval",
  "Optional ocular visit scheduling for first-time guests",
  "Check-in preparation and final confirmation",
];

export const reservationRecordsColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" },
  { key: "guest", label: "Guest" },
  { key: "source", label: "Source" },
  { key: "stay", label: "Stay Dates" },
  { key: "payment", label: "Payment" },
  { key: "status", label: "Status" },
];

export const reservationRecordsRows: AdminTableRow[] = [
  {
    id: "rr-1",
    reference: "MV-2026-0148",
    guest: "Lian Dela Cruz",
    source: "Website",
    stay: "2026-04-02 to 2026-04-04",
    payment: "Downpayment Verified",
    status: "Confirmed",
  },
  {
    id: "rr-2",
    reference: "MV-2026-0149",
    guest: "Harold Pineda",
    source: "Walk-in",
    stay: "2026-04-06 to 2026-04-07",
    payment: "Pending Verification",
    status: "Pending",
  },
  {
    id: "rr-3",
    reference: "MV-2026-0150",
    guest: "Samantha Ong",
    source: "Website",
    stay: "2026-04-10 to 2026-04-12",
    payment: "Full Payment",
    status: "Confirmed",
  },
];

export const paymentVerificationColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" },
  { key: "method", label: "Method" },
  { key: "amount", label: "Amount" },
  { key: "submitted", label: "Submitted At" },
  { key: "reviewer", label: "Assigned Staff" },
];

export const paymentVerificationRows: AdminTableRow[] = [
  {
    id: "pv-1",
    reference: "MV-2026-0149",
    method: "E-wallet",
    amount: "₱8,500",
    submitted: "2026-03-26 09:22",
    reviewer: "Bea Navarro",
  },
  {
    id: "pv-2",
    reference: "MV-2026-0152",
    method: "Bank Transfer",
    amount: "₱12,000",
    submitted: "2026-03-26 08:47",
    reviewer: "Alex Mendoza",
  },
];

export const manualEntryColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" },
  { key: "encodedBy", label: "Encoded By" },
  { key: "guest", label: "Guest Name" },
  { key: "guests", label: "Total Guests" },
  { key: "notes", label: "Notes" },
];

export const manualEntryRows: AdminTableRow[] = [
  {
    id: "me-1",
    reference: "MV-2026-0153",
    encodedBy: "Carlo Lim",
    guest: "Carlos Fernandez",
    guests: "18",
    notes: "Corporate day-tour booking",
  },
  {
    id: "me-2",
    reference: "MV-2026-0154",
    encodedBy: "Bea Navarro",
    guest: "Mara Hidalgo",
    guests: "6",
    notes: "Walk-in with add-on cottage",
  },
];

export const scheduleBlocksColumns: AdminTableColumn[] = [
  { key: "date", label: "Date" },
  { key: "type", label: "Block Type" },
  { key: "reason", label: "Reason" },
  { key: "createdBy", label: "Created By" },
  { key: "status", label: "Status" },
];

export const scheduleBlocksRows: AdminTableRow[] = [
  {
    id: "sb-1",
    date: "2026-04-05",
    type: "Maintenance",
    reason: "Main pool filtration upgrade",
    createdBy: "Alex Mendoza",
    status: "Blocked",
  },
  {
    id: "sb-2",
    date: "2026-04-12",
    type: "Private Event",
    reason: "Whole-resort wedding buyout",
    createdBy: "Bea Navarro",
    status: "Blocked",
  },
  {
    id: "sb-3",
    date: "2026-04-20",
    type: "Public Access",
    reason: "Open for day tours",
    createdBy: "Carlo Lim",
    status: "Open",
  },
];

export const publicAccessColumns: AdminTableColumn[] = [
  { key: "date", label: "Date" },
  { key: "slots", label: "Available Slots" },
  { key: "booked", label: "Booked" },
  { key: "remaining", label: "Remaining" },
];

export const publicAccessRows: AdminTableRow[] = [
  { id: "pa-1", date: "2026-04-20", slots: "120", booked: "74", remaining: "46" },
  { id: "pa-2", date: "2026-04-21", slots: "120", booked: "102", remaining: "18" },
  { id: "pa-3", date: "2026-04-22", slots: "120", booked: "59", remaining: "61" },
];

export const transactionMetrics: AdminMetric[] = [
  { label: "Total Due", value: "₱1,024,600", trend: "Current billing cycle" },
  { label: "Collected", value: "₱756,200", trend: "73.8% collected" },
  { label: "Outstanding", value: "₱268,400", trend: "Requires follow-up" },
  { label: "Pending Verifications", value: "6", trend: "Payment proofs queued" },
];

export const transactionColumns: AdminTableColumn[] = [
  { key: "reference", label: "Reference" },
  { key: "total", label: "Total Amount" },
  { key: "paid", label: "Paid Amount" },
  { key: "balance", label: "Balance" },
  { key: "status", label: "Status" },
];

export const transactionRows: AdminTableRow[] = [
  {
    id: "tr-1",
    reference: "MV-2026-0148",
    total: "₱45,000",
    paid: "₱45,000",
    balance: "₱0",
    status: "Paid",
  },
  {
    id: "tr-2",
    reference: "MV-2026-0149",
    total: "₱32,500",
    paid: "₱8,500",
    balance: "₱24,000",
    status: "Partial",
  },
  {
    id: "tr-3",
    reference: "MV-2026-0150",
    total: "₱67,200",
    paid: "₱20,000",
    balance: "₱47,200",
    status: "Partial",
  },
];

export const invoiceColumns: AdminTableColumn[] = [
  { key: "invoice", label: "Invoice No." },
  { key: "reference", label: "Reference" },
  { key: "generatedAt", label: "Generated At" },
  { key: "amount", label: "Amount" },
];

export const invoiceRows: AdminTableRow[] = [
  {
    id: "inv-1",
    invoice: "INV-2026-0221",
    reference: "MV-2026-0148",
    generatedAt: "2026-03-26 09:30",
    amount: "₱45,000",
  },
  {
    id: "inv-2",
    invoice: "INV-2026-0222",
    reference: "MV-2026-0150",
    generatedAt: "2026-03-26 08:10",
    amount: "₱67,200",
  },
];

export const receiptColumns: AdminTableColumn[] = [
  { key: "receipt", label: "Receipt No." },
  { key: "reference", label: "Reference" },
  { key: "method", label: "Method" },
  { key: "amount", label: "Amount" },
  { key: "postedAt", label: "Posted At" },
];

export const receiptRows: AdminTableRow[] = [
  {
    id: "or-1",
    receipt: "OR-2026-1901",
    reference: "MV-2026-0148",
    method: "Bank Transfer",
    amount: "₱45,000",
    postedAt: "2026-03-26 09:41",
  },
  {
    id: "or-2",
    receipt: "OR-2026-1902",
    reference: "MV-2026-0149",
    method: "E-wallet",
    amount: "₱8,500",
    postedAt: "2026-03-26 09:12",
  },
];

export const reportModules = [
  {
    title: "Sales Report",
    description: "Revenue overview by day, week, or month with category-level income breakdown.",
  },
  {
    title: "Financial Report",
    description: "Track payments, pending balances, and period-level cash flow movement.",
  },
  {
    title: "Guest Report",
    description: "Monitor booking history, contact profiles, and repeat-visit patterns.",
  },
  {
    title: "Staff Report",
    description: "Review staff operational actions and accountability indicators.",
  },
];

export const reportSnapshotColumns: AdminTableColumn[] = [
  { key: "report", label: "Report" },
  { key: "period", label: "Period" },
  { key: "summary", label: "Summary" },
  { key: "updated", label: "Last Updated" },
];

export const reportSnapshotRows: AdminTableRow[] = [
  {
    id: "rs-1",
    report: "Sales",
    period: "March 2026",
    summary: "₱2.84M gross revenue, +11.3% MoM",
    updated: "2026-03-26 09:20",
  },
  {
    id: "rs-2",
    report: "Financial",
    period: "Week 13",
    summary: "₱268K outstanding, 6 pending verifications",
    updated: "2026-03-26 09:18",
  },
  {
    id: "rs-3",
    report: "Guest",
    period: "Q1 2026",
    summary: "41% repeat guests, avg stay 2.8 nights",
    updated: "2026-03-25 18:40",
  },
];

export const analyticsPanels = [
  {
    label: "Booking Trend Analysis",
    detail: "High demand observed on long weekends and holiday-adjacent dates.",
  },
  {
    label: "Revenue Forecasting",
    detail: "Projected April revenue: ₱3.1M to ₱3.4M based on current confirmations.",
  },
  {
    label: "Performance Signals",
    detail: "Public access slots nearing capacity on 2026-04-21 and 2026-04-28.",
  },
];

export const forecastColumns: AdminTableColumn[] = [
  { key: "period", label: "Period" },
  { key: "projectedBookings", label: "Projected Bookings" },
  { key: "projectedRevenue", label: "Projected Revenue" },
  { key: "confidence", label: "Confidence" },
];

export const forecastRows: AdminTableRow[] = [
  {
    id: "fc-1",
    period: "2026-04 Week 1",
    projectedBookings: "44",
    projectedRevenue: "₱742,000",
    confidence: "High",
  },
  {
    id: "fc-2",
    period: "2026-04 Week 2",
    projectedBookings: "39",
    projectedRevenue: "₱661,500",
    confidence: "Medium",
  },
  {
    id: "fc-3",
    period: "2026-04 Week 3",
    projectedBookings: "47",
    projectedRevenue: "₱808,900",
    confidence: "High",
  },
];

export const usersColumns: AdminTableColumn[] = [
  { key: "name", label: "Name" },
  { key: "role", label: "Role" },
  { key: "email", label: "Email" },
  { key: "lastLogin", label: "Last Login" },
  { key: "status", label: "Status" },
];

export const usersRows: AdminTableRow[] = [
  {
    id: "usr-1",
    name: "Alex Mendoza",
    role: "admin",
    email: "alex@marville.example",
    lastLogin: "2026-03-26 08:00",
    status: "Active",
  },
  {
    id: "usr-2",
    name: "Bea Navarro",
    role: "staff",
    email: "bea@marville.example",
    lastLogin: "2026-03-26 08:11",
    status: "Active",
  },
  {
    id: "usr-3",
    name: "Carlo Lim",
    role: "staff",
    email: "carlo@marville.example",
    lastLogin: "2026-03-24 16:40",
    status: "Inactive",
  },
];

export const permissionColumns: AdminTableColumn[] = [
  { key: "module", label: "Module" },
  { key: "admin", label: "Admin Access" },
  { key: "staff", label: "Staff Access" },
];

export const permissionRows: AdminTableRow[] = [
  { id: "perm-1", module: "User Management", admin: "Full", staff: "View" },
  { id: "perm-2", module: "Reservation Approval", admin: "Full", staff: "Full" },
  { id: "perm-3", module: "Reports Export", admin: "Full", staff: "Restricted" },
];

export const auditColumns: AdminTableColumn[] = [
  { key: "staff", label: "Staff" },
  { key: "module", label: "Module" },
  { key: "action", label: "Action" },
  { key: "record", label: "Affected Record" },
  { key: "timestamp", label: "Date & Time" },
];

export const auditRows: AdminTableRow[] = [
  {
    id: "ad-1",
    staff: "Alex Mendoza",
    module: "Reservations",
    action: "Confirmed reservation",
    record: "MV-2026-0148",
    timestamp: "2026-03-26 09:14",
  },
  {
    id: "ad-2",
    staff: "Bea Navarro",
    module: "Transactions",
    action: "Verified e-wallet payment",
    record: "OR-2026-1902",
    timestamp: "2026-03-26 08:52",
  },
  {
    id: "ad-3",
    staff: "Carlo Lim",
    module: "Schedules",
    action: "Blocked date for maintenance",
    record: "2026-04-05",
    timestamp: "2026-03-25 17:30",
  },
  {
    id: "ad-4",
    staff: "Alex Mendoza",
    module: "Users",
    action: "Updated staff role permissions",
    record: "carlo@marville.example",
    timestamp: "2026-03-25 16:10",
  },
];
