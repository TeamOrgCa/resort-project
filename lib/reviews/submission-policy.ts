export const REVIEW_SUBMISSION_HELP = "You can share multiple reviews: wait 10 minutes between submissions, with a maximum of 3 reviews in 24 hours. Duplicate content within 24 hours is not accepted. Each linked reservation can have one review.";

export function reviewRetrySeconds(value: unknown) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(86400, Math.ceil(seconds)) : 600;
}
