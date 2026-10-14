export type CancellationPreview = {
  reservationId: string; reference: string; initiator: "guest" | "resort";
  totalAmount: number; verifiedPaid: number; previousRefunds: number; netPaid: number;
  depositBase: number; depositAmount: number; deduction: number; refundableAmount: number;
  policyVersion: number; noticeHours: number; allowed: boolean; blockedReason: string | null;
  outcome: "pending_refund" | "no_refund"; rule: string; quote: string;
};
export const refundStatusLabels: Record<string, string> = {
  pending: "Pending refund review", reviewed: "Awaiting administrator approval", approved: "Approved - awaiting transfer",
  payout_submitted: "Transfer submitted - awaiting verification", refunded: "Refunded", rejected: "Refund rejected",
};
export const cancellationMessage = (preview: CancellationPreview) => preview.refundableAmount > 0
  ? `Reservation cancelled. Your PHP ${Number(preview.refundableAmount).toFixed(2)} refund request was created automatically and is pending review. No money has been released.`
  : "Cancelled - No Refund. There are no refundable verified payments under this cancellation policy.";
