export const REVIEW_COMPLETED_STAY_REQUIRED = "Complete a resort stay before submitting a review. Staff must check out your stay and mark the reservation Completed.";
export const REVIEW_SUBMISSION_HELP = "Only guests with a completed stay can submit a review. Wait 10 minutes between submissions, with a maximum of 3 reviews in 24 hours. Duplicate content within 24 hours is not accepted. Each linked completed reservation can have one review.";

export function reviewRetrySeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : 600;
}
