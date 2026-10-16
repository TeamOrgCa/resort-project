"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect, useMemo, useRef } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { REVIEW_IMAGE_HELP, REVIEW_IMAGE_MAX_BYTES, REVIEW_IMAGE_MIME_TYPES } from "@/lib/reviews/images";
import { REVIEW_SUBMISSION_HELP, reviewRetrySeconds } from "@/lib/reviews/submission-policy";
import FormErrorDialog from "@/components/ui/FormErrorDialog";

type ReviewItem = {
  review_id: string;
  guest_name: string;
  overall_rating: number;
  title: string;
  review_text: string;
  created_at: string;
  image_url?: string | null;
};

export default function Reviews() {
  const [showForm, setShowForm] = useState(false);
  const [checkingStay, setCheckingStay] = useState(false);
  const [eligibilityMessage, setEligibilityMessage] = useState<string | null>(null);
  const [completedStays, setCompletedStays] = useState<{ reservation_id: string; reference_number: string; end_datetime: string }[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const submitting = useRef(false);
  const [hoverRating, setHoverRating] = useState(0);
  const [existingReviews, setExistingReviews] = useState<ReviewItem[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewImage, setReviewImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    overallRating: 0,
    cleanlinessRating: 0,
    serviceRating: 0,
    amenitiesRating: 0,
    valueRating: 0,
    title: "",
    review: "",
    wouldRecommend: true,
    reservationId: "",
  });

  useEffect(() => () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
  }, [imagePreview]);

  function selectImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.size || file.size > REVIEW_IMAGE_MAX_BYTES || !REVIEW_IMAGE_MIME_TYPES.some(type => type === file.type)) {
      setError(REVIEW_IMAGE_HELP);
      return;
    }
    setReviewImage(file);
    setImagePreview(URL.createObjectURL(file));
    setError(null);
  }

  // Fetch reviews on mount
  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setReviewsLoading(true);
        const response = await fetch("/api/reviews?limit=20&offset=0");
        if (response.ok) {
          const data = await response.json();
          setExistingReviews(data.reviews || []);
        }
      } catch (err) {
        console.error("Failed to fetch reviews:", err);
      } finally {
        setReviewsLoading(false);
      }
    };

    fetchReviews();
  }, []);

  const ratingSummary = useMemo(() => {
    const total = existingReviews.length;
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    if (total === 0) {
      return {
        average: 0,
        total,
        distribution: [5, 4, 3, 2, 1].map((stars) => ({
          stars,
          percentage: 0,
        })),
      };
    }

    let sum = 0;

    for (const review of existingReviews) {
      const normalized = Math.min(
        5,
        Math.max(1, Math.round(Number(review.overall_rating) || 0))
      ) as 1 | 2 | 3 | 4 | 5;

      counts[normalized] += 1;
      sum += normalized;
    }

    return {
      average: Math.round((sum / total) * 10) / 10,
      total,
      distribution: [5, 4, 3, 2, 1].map((stars) => ({
        stars,
        percentage: Math.round((counts[stars as 1 | 2 | 3 | 4 | 5] / total) * 1000) / 10,
      })),
    };
  }, [existingReviews]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setLoading(true);
    setError(null);

    try {
      const payload = new FormData();
      payload.set("review", JSON.stringify({
        overall_rating: formData.overallRating,
        cleanliness_rating: formData.cleanlinessRating || null,
        service_rating: formData.serviceRating || null,
        amenities_rating: formData.amenitiesRating || null,
        value_rating: formData.valueRating || null,
        title: formData.title,
        review_text: formData.review,
        would_recommend: formData.wouldRecommend,
        reservation_id: formData.reservationId || null,
      }));
      if (reviewImage) payload.set("image", reviewImage);
      const response = await fetch("/api/reviews/create", {
        method: "POST",
        body: payload,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          (errorData.error || "Failed to submit review. Please try again.") + (response.status === 429
            ? ` Try again after ${new Date(Date.now() + reviewRetrySeconds(errorData.retryAfter) * 1000).toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })} (Philippine time).` : "")
        );
      }

      setSubmitted(true);
      setShowForm(false);
      setReviewImage(null);
      setImagePreview(null);
    } catch (err) {
      setErrorOpen(true);
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred. Please try again."
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  async function openReviewForm() {
    if (checkingStay) return;
    setCheckingStay(true); setEligibilityMessage(null);
    try {
      const response = await fetch("/api/reviews/eligibility", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.eligible) { setEligibilityMessage(data.message ?? "Complete a resort stay before submitting a review."); return; }
      setCompletedStays(data.reservations ?? []); setShowForm(true);
    } catch { setEligibilityMessage("Unable to check your completed stays. Please try again."); }
    finally { setCheckingStay(false); }
  }

  const StarRating = ({ value, onChange, readonly = false }: { value: number; onChange?: (rating: number) => void; readonly?: boolean }) => {
    return (
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => !readonly && onChange && onChange(star)}
            onMouseEnter={() => !readonly && setHoverRating(star)}
            onMouseLeave={() => !readonly && setHoverRating(0)}
            className={`text-3xl transition-colors ${readonly ? "cursor-default" : "cursor-pointer"}
              ${star <= (readonly ? value : (hoverRating || value)) ? "text-highlight" : "text-neutral/20"}
            `}
          >
            ★
          </button>
        ))}
      </div>
    );
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-base flex items-center justify-center px-4">
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-5 sm:p-12 text-center">
          <div className="w-20 h-20 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-neutral mb-4">Thank You!</h1>
          <p className="text-xl text-neutral/70 mb-8">Your review has been submitted successfully</p>

          <div className="booking-summary bg-base p-4 sm:p-8 rounded-2xl mb-8">
            <p className="text-neutral/80">
              We appreciate you taking the time to share your experience. Your feedback helps us improve our services 
              and helps future guests make informed decisions. Your review and any attached photo have been submitted.
            </p>
            <p className="mt-3 text-sm text-neutral/70">{REVIEW_SUBMISSION_HELP}</p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            <Link href="/" className="flex-1">
              <button className="w-full bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors">
                Return Home
              </button>
            </Link>
            <Link href="/booking" className="flex-1">
              <button className="w-full bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105">
                Book Another Stay
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base">
      <Navigation />

      {/* Hero Section */}
      <section className="relative h-80 flex items-center justify-center overflow-hidden mt-20">
        <Image 
          src="/website_photo.jpg" 
          alt="Reviews" 
          fill 
          className="object-cover brightness-75" 
          priority
        />
        <div className="absolute inset-0 bg-neutral/40"></div>
        <div className="relative z-10 text-center px-4">
          <h1 className="text-6xl font-bold text-base mb-4">Guest Reviews</h1>
          <p className="text-xl text-base/90">See what our guests are saying</p>
        </div>
      </section>

      {/* Rating Summary */}
      <section className="py-12 px-4 bg-white">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 items-center">
            <div className="text-center">
              <div className="text-6xl font-bold text-primary mb-2">
                {ratingSummary.average.toFixed(1)}
              </div>
              <div className="flex justify-center mb-2">
                <StarRating
                  value={Math.round(ratingSummary.average)}
                  readonly
                />
              </div>
              <p className="text-neutral/70">
                Based on {ratingSummary.total} review{ratingSummary.total === 1 ? "" : "s"}
              </p>
            </div>
            
            <div className="md:col-span-2 space-y-3">
              {ratingSummary.distribution.map((item) => (
                <div key={item.stars} className="flex items-center gap-4">
                  <span className="text-sm text-neutral/70 w-12">{item.stars} stars</span>
                  <div className="flex-1 bg-neutral/10 rounded-full h-3">
                    <div className="bg-highlight h-3 rounded-full" style={{ width: `${item.percentage}%` }}></div>
                  </div>
                  <span className="text-sm text-neutral/70 w-12 text-right">{item.percentage}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center mb-8 sm:mb-12">
            <h2 className="text-3xl font-bold text-neutral">Guest Reviews ({existingReviews.length})</h2>
            {!showForm && (
              <button
                onClick={() => void openReviewForm()}
                disabled={checkingStay}
                className="bg-primary text-base px-6 py-3 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105"
              >
                {checkingStay ? "Checking completed stays..." : "Write a Review"}
              </button>
            )}
          </div>

          {eligibilityMessage && <p role="alert" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{eligibilityMessage}</p>}
          {showForm && (
            <div className="bg-white rounded-3xl shadow-xl p-4 sm:p-8 mb-12">
              <div className="flex items-start justify-between gap-3 mb-6 sm:mb-8">
                <h3 className="text-2xl font-bold text-neutral">Share Your Experience</h3>
                <button
                  onClick={() => setShowForm(false)}
                  type="button"
                  disabled={loading}
                  aria-label="Close review form"
                  className="text-neutral/50 hover:text-neutral transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <fieldset disabled={loading} className="space-y-6">
                  <p className="rounded-xl bg-base p-3 text-sm text-neutral/75">{REVIEW_SUBMISSION_HELP}</p>
                  {/* Overall Rating */}
                  <div>
                    <label className="block text-sm font-medium text-neutral/70 mb-3">Overall Rating *</label>
                    <StarRating value={formData.overallRating} onChange={(rating) => setFormData({ ...formData, overallRating: rating })} />
                  </div>

                  {/* Category Ratings */}
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Cleanliness</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setFormData({ ...formData, cleanlinessRating: star })}
                            className={`text-2xl ${star <= formData.cleanlinessRating ? "text-highlight" : "text-neutral/20"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Service</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setFormData({ ...formData, serviceRating: star })}
                            className={`text-2xl ${star <= formData.serviceRating ? "text-highlight" : "text-neutral/20"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Amenities</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setFormData({ ...formData, amenitiesRating: star })}
                            className={`text-2xl ${star <= formData.amenitiesRating ? "text-highlight" : "text-neutral/20"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Value for Money</label>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setFormData({ ...formData, valueRating: star })}
                            className={`text-2xl ${star <= formData.valueRating ? "text-highlight" : "text-neutral/20"}`}
                          >
                            ★
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Review Title */}
                  <div>
                    <label className="block text-sm font-medium text-neutral/70 mb-2">Review Title *</label>
                    <input
                      type="text"
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      placeholder="Summarize your experience"
                      className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      required
                      maxLength={200}
                    />
                  </div>

                  {/* Review Text */}
                  <div>
                    <label className="block text-sm font-medium text-neutral/70 mb-2">Your Review *</label>
                    <textarea
                      value={formData.review}
                      onChange={(e) => setFormData({ ...formData, review: e.target.value })}
                      rows={6}
                      placeholder="Share details about your stay..."
                      className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                      required
                      minLength={50}
                      maxLength={5000}
                    ></textarea>
                    <p className="text-xs text-neutral/60 mt-2">Minimum 50 characters</p>
                  </div>

                  <div>
                    <label htmlFor="review-photo" className="block text-sm font-medium text-neutral/70 mb-2">Add a photo (optional)</label>
                    <p id="review-photo-help" className="mb-3 text-xs text-neutral/60">{REVIEW_IMAGE_HELP} Your photo will be shown with your published review.</p>
                    <input id="review-photo" type="file" accept={REVIEW_IMAGE_MIME_TYPES.join(",")} onChange={selectImage} aria-describedby="review-photo-help" className="block w-full rounded-xl border border-dashed border-neutral/25 bg-base/40 p-3 text-sm text-neutral file:mr-3 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:font-semibold file:text-primary" />
                    {imagePreview && <div className="mt-4 max-w-sm rounded-xl border border-neutral/10 p-3">
                      <Image src={imagePreview} alt="Your selected review photo" width={480} height={320} unoptimized className="max-h-60 w-full rounded-lg object-contain" />
                      <div className="mt-3 flex items-center justify-between gap-3"><span className="min-w-0 truncate text-xs text-neutral/60">{reviewImage?.name}</span><button type="button" onClick={() => { setReviewImage(null); setImagePreview(null); setError(null); }} className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Remove photo</button></div>
                    </div>}
                  </div>

                  {/* Optional completed stay link */}
                  <div>
                    <label htmlFor="review-completed-stay" className="block text-sm font-medium text-neutral/70 mb-2">Completed stay (optional)</label>
                    <select id="review-completed-stay"
                      value={formData.reservationId}
                      onChange={(e) => setFormData({ ...formData, reservationId: e.target.value })}
                      className="w-full px-4 py-3 rounded-lg border border-neutral/20 bg-white text-black focus:border-primary focus:outline-none"
                    ><option value="">General feedback about my completed stay</option>{completedStays.map(stay => <option key={stay.reservation_id} value={stay.reservation_id}>{stay.reference_number} — {new Date(stay.end_datetime).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })}</option>)}</select>
                  </div>

                  {/* Would Recommend */}
                  <div>
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.wouldRecommend}
                        onChange={(e) => setFormData({ ...formData, wouldRecommend: e.target.checked })}
                        className="w-5 h-5 text-primary rounded"
                      />
                      <span className="text-neutral">I would recommend MarVille Resort to friends and family</span>
                    </label>
                  </div>
                </fieldset>

                <div className="mt-8 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    disabled={loading}
                    className="flex-1 bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105 disabled:opacity-50 disabled:scale-100"
                  >
                    {loading ? "Submitting..." : "Submit Review"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Existing Reviews */}
          <div className="space-y-6">
            {reviewsLoading ? (
              <div className="text-center py-12">
                <p className="text-neutral/70">Loading reviews...</p>
              </div>
            ) : existingReviews.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-neutral/70">No reviews yet. Be the first to share your experience!</p>
              </div>
            ) : (
              existingReviews.map((review) => (
                <div key={review.review_id} className="bg-white rounded-3xl shadow-lg p-4 sm:p-8">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                          {(review.guest_name || "Verified Guest").charAt(0)}
                        </div>
                        <div>
                          <p className="font-semibold text-neutral">{review.guest_name || "Verified Guest"}</p>
                          <div className="flex items-center gap-2">
                            <StarRating value={review.overall_rating} readonly />
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-neutral/60">
                        {new Date(review.created_at).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </p>
                    </div>
                  </div>
                  <h3 className="text-xl font-bold text-neutral mb-3">{review.title}</h3>
                  <p className="text-neutral/80 leading-relaxed">{review.review_text}</p>
                  {review.image_url && <a href={review.image_url} target="_blank" rel="noopener noreferrer" className="mt-5 block max-w-md rounded-xl focus-visible:outline-2 focus-visible:outline-primary" aria-label={`View photo attached to ${review.title}`}>
                    <Image src={review.image_url} alt={`Guest photo for ${review.title}`} width={640} height={420} unoptimized className="max-h-80 w-full rounded-xl object-cover" loading="lazy" />
                    <span className="mt-2 block text-xs font-medium text-primary">View full photo</span>
                  </a>}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <Footer />
      {errorOpen && <FormErrorDialog title="Review could not be submitted" message={error ?? "Please try again."} onClose={() => setErrorOpen(false)} />}
    </div>
  );
}
