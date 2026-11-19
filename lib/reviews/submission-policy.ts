export const REVIEW_COMPLETED_STAY_REQUIRED = "Complete a resort stay before submitting a review. Staff must check out your stay and mark the reservation Completed.";
export const REVIEW_TITLE_MIN_LENGTH = 5;
export const REVIEW_TITLE_MAX_LENGTH = 100;
export const REVIEW_TEXT_MIN_LENGTH = 20;
export const REVIEW_TEXT_MAX_LENGTH = 1000;

export function reviewContentError(title: unknown, text: unknown) {
  if (typeof title !== "string" || title.trim().length < REVIEW_TITLE_MIN_LENGTH || title.trim().length > REVIEW_TITLE_MAX_LENGTH) {
    return "Enter a review title between 5 and 100 characters.";
  }
  if (typeof text !== "string" || text.trim().length < REVIEW_TEXT_MIN_LENGTH || text.trim().length > REVIEW_TEXT_MAX_LENGTH) {
    return "Review description must be between 20 and 1,000 characters.";
  }
  return null;
}
export const REVIEW_SUBMISSION_HELP = "Only guests with a completed stay can submit a review. Wait 10 minutes between submissions, with a maximum of 3 reviews in 24 hours. Duplicate content within 24 hours is not accepted. Each linked completed reservation can have one review.";

export function reviewRetrySeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : 600;
}
