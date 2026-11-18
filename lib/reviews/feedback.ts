export type GuestFeedbackItem = {
  review_id: string; public_display_name: string | null; overall_rating: number; title: string; review_text: string;
  would_recommend: boolean | null; is_approved: boolean; created_at: string; archived_at: string | null;
  updated_at?: string;
  archive_reason: string | null; image_url: string | null;
};
