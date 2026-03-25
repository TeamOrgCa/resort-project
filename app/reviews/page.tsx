"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function Reviews() {
  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    bookingRef: "",
    stayDate: "",
    overallRating: 0,
    cleanlinessRating: 0,
    serviceRating: 0,
    amenitiesRating: 0,
    valueRating: 0,
    title: "",
    review: "",
    wouldRecommend: true,
  });

  // Mock existing reviews
  const existingReviews = [
    {
      id: 1,
      name: "Sarah Johnson",
      rating: 5,
      date: "February 15, 2026",
      title: "Absolutely Paradise!",
      review: "Our stay at MarVille Resort exceeded all expectations. The ocean view from our room was breathtaking, and the staff went above and beyond to make our anniversary special. The spa treatments were divine, and the beachfront dinners were unforgettable. We can't wait to return!",
      verified: true,
    },
    {
      id: 2,
      name: "Michael Chen",
      rating: 5,
      date: "February 10, 2026",
      title: "Perfect Family Vacation",
      review: "We brought our kids here for spring break and it was the best decision ever. The resort has activities for all ages, the pools were pristine, and the kids' club was fantastic. The room was spacious and clean. Highly recommend for families!",
      verified: true,
    },
    {
      id: 3,
      name: "Emma Rodriguez",
      rating: 4,
      date: "January 28, 2026",
      title: "Beautiful Resort with Great Amenities",
      review: "The resort is stunning and well-maintained. We particularly enjoyed the water sports and the evening entertainment. The only minor issue was the wait time at the main restaurant during peak hours, but it was worth it. Overall, a wonderful experience!",
      verified: true,
    },
    {
      id: 4,
      name: "David Thompson",
      rating: 5,
      date: "January 20, 2026",
      title: "Dream Honeymoon Destination",
      review: "MarVille Resort made our honeymoon magical. From the moment we arrived, we felt pampered and special. The beach villa was luxurious, the sunset views were incredible, and the romantic dinners were perfectly arranged. Thank you for making our trip unforgettable!",
      verified: true,
    },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

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
        <div className="max-w-2xl w-full bg-white rounded-3xl shadow-2xl p-12 text-center">
          <div className="w-20 h-20 bg-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-12 h-12 text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold text-neutral mb-4">Thank You!</h1>
          <p className="text-xl text-neutral/70 mb-8">Your review has been submitted successfully</p>

          <div className="bg-base p-8 rounded-2xl mb-8">
            <p className="text-neutral/80">
              We appreciate you taking the time to share your experience. Your feedback helps us improve our services 
              and helps future guests make informed decisions. Your review will be published after verification.
            </p>
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
              <div className="text-6xl font-bold text-primary mb-2">4.9</div>
              <div className="flex justify-center mb-2">
                <StarRating value={5} readonly />
              </div>
              <p className="text-neutral/70">Based on 156 reviews</p>
            </div>
            
            <div className="md:col-span-2 space-y-3">
              {[
                { stars: 5, percentage: 92 },
                { stars: 4, percentage: 6 },
                { stars: 3, percentage: 1 },
                { stars: 2, percentage: 0.5 },
                { stars: 1, percentage: 0.5 },
              ].map((item) => (
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
          <div className="flex justify-between items-center mb-12">
            <h2 className="text-3xl font-bold text-neutral">Guest Reviews ({existingReviews.length})</h2>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="bg-primary text-base px-6 py-3 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105"
              >
                Write a Review
              </button>
            )}
          </div>

          {showForm && (
            <div className="bg-white rounded-3xl shadow-xl p-8 mb-12">
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-bold text-neutral">Share Your Experience</h3>
                <button
                  onClick={() => setShowForm(false)}
                  className="text-neutral/50 hover:text-neutral transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <form onSubmit={handleSubmit}>
                <div className="space-y-6">
                  {/* Personal Information */}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Full Name *</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Email Address *</label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Booking Reference *</label>
                      <input
                        type="text"
                        value={formData.bookingRef}
                        onChange={(e) => setFormData({ ...formData, bookingRef: e.target.value })}
                        placeholder="SR-XXXXXXXX"
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-neutral/70 mb-2">Date of Stay *</label>
                      <input
                        type="date"
                        value={formData.stayDate}
                        onChange={(e) => setFormData({ ...formData, stayDate: e.target.value })}
                        className="w-full px-4 py-3 rounded-lg border border-neutral/20 focus:border-primary focus:outline-none"
                        required
                      />
                    </div>
                  </div>

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
                    ></textarea>
                    <p className="text-xs text-neutral/60 mt-2">Minimum 50 characters</p>
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
                </div>

                <div className="mt-8 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 bg-neutral/10 text-neutral px-6 py-4 rounded-full font-semibold hover:bg-neutral/20 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-primary text-base px-6 py-4 rounded-full font-semibold hover:bg-primary/90 transition-all transform hover:scale-105"
                  >
                    Submit Review
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Existing Reviews */}
          <div className="space-y-6">
            {existingReviews.map((review) => (
              <div key={review.id} className="bg-white rounded-3xl shadow-lg p-8">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center font-bold text-primary">
                        {review.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-semibold text-neutral">{review.name}</p>
                        {review.verified && (
                          <p className="text-xs text-secondary flex items-center gap-1">
                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Verified Stay
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <StarRating value={review.rating} readonly />
                    </div>
                    <p className="text-sm text-neutral/60">{review.date}</p>
                  </div>
                </div>
                <h3 className="text-xl font-bold text-neutral mb-3">{review.title}</h3>
                <p className="text-neutral/80 leading-relaxed">{review.review}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
