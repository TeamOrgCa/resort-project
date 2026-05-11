import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { notifyGuestAndStaff } from "@/lib/notifications";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get authenticated user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized. Please log in to submit a review." },
        { status: 401 }
      );
    }

    // Verify user is a guest
    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .select("id, first_name, last_name")
      .eq("id", user.id)
      .single();

    if (guestError || !guest) {
      return NextResponse.json(
        { error: "Only registered guests can submit reviews." },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const {
      overall_rating,
      cleanliness_rating,
      service_rating,
      amenities_rating,
      value_rating,
      title,
      review_text,
      would_recommend,
      reservation_id,
    } = body;

    // Validate required fields
    if (!overall_rating || !title || !review_text) {
      return NextResponse.json(
        {
          error: "Missing required fields: overall_rating, title, and review_text are required.",
        },
        { status: 400 }
      );
    }

    // Validate ratings are between 1-5
    const ratings = [
      overall_rating,
      cleanliness_rating,
      service_rating,
      amenities_rating,
      value_rating,
    ];

    for (const rating of ratings) {
      if (rating && (rating < 1 || rating > 5)) {
        return NextResponse.json(
          { error: "All ratings must be between 1 and 5." },
          { status: 400 }
        );
      }
    }

    // Validate title and review length
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "Title must be a non-empty string." },
        { status: 400 }
      );
    }

    if (typeof review_text !== "string" || review_text.trim().length < 50) {
      return NextResponse.json(
        {
          error: "Review text must be at least 50 characters long.",
        },
        { status: 400 }
      );
    }

    // Check if guest already has a review (one review per guest constraint)
    const { data: existingReview } = await supabase
      .from("reviews")
      .select("review_id")
      .eq("guest_id", user.id)
      .single();

    if (existingReview) {
      return NextResponse.json(
        {
          error: "You have already submitted a review. Each guest can only submit one review.",
        },
        { status: 409 }
      );
    }

    // If reservation_id is provided, validate it belongs to this guest
    if (reservation_id) {
      const { data: reservation, error: reservationError } = await supabase
        .from("reservations")
        .select("reservation_id")
        .eq("reservation_id", reservation_id)
        .eq("guest_id", user.id)
        .single();

      if (reservationError || !reservation) {
        return NextResponse.json(
          {
            error: "Invalid reservation ID or reservation does not belong to you.",
          },
          { status: 400 }
        );
      }
    }

    const publicDisplayName = `${guest.first_name} ${guest.last_name}`.trim();

    // Create review
    const { data: newReview, error: insertError } = await supabase
      .from("reviews")
      .insert({
        guest_id: user.id,
        reservation_id: reservation_id || null,
        overall_rating,
        cleanliness_rating: cleanliness_rating || null,
        service_rating: service_rating || null,
        amenities_rating: amenities_rating || null,
        value_rating: value_rating || null,
        title: title.trim(),
        review_text: review_text.trim(),
        public_display_name: publicDisplayName || "Verified Guest",
        would_recommend: would_recommend ?? true,
        is_approved: true, // Auto-approve for now (can be changed to false for moderation)
      })
      .select()
      .single();

    if (insertError) {
      console.error("Review insertion error:", insertError);
      return NextResponse.json(
        { error: "Failed to create review. Please try again." },
        { status: 500 }
      );
    }

    const { error: notificationError } = await notifyGuestAndStaff(supabase, {
      actorId: user.id,
      guestId: user.id,
      title: "Review submitted",
      message: "Thanks for sharing your experience.",
      entityType: "review",
      entityId: newReview.review_id,
      guestActionUrl: "/reviews",
      staffActionUrl: "/admin",
    });

    if (notificationError) {
      console.warn("Failed to create review notifications:", notificationError);
    }

    return NextResponse.json(
      {
        message: "Review submitted successfully!",
        review: newReview,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Review endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500 }
    );
  }
}
