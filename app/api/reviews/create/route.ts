import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { createNotifications, NOTIFICATION_AUDIENCES } from "@/lib/notifications";
import { createAdminClient } from "@/lib/supabase/admin";
import { contentImageExtension } from "@/lib/settings/content-images";
import { REVIEW_IMAGE_BUCKET, REVIEW_IMAGE_MAX_BYTES, REVIEW_IMAGE_HELP } from "@/lib/reviews/images";

export async function POST(request: NextRequest) {
  let uploadedPath: string | null = null;
  let storage: ReturnType<ReturnType<typeof createAdminClient>["storage"]["from"]> | null = null;
  async function removeUpload() {
    if (!uploadedPath || !storage) return;
    try {
      const { error } = await storage.remove([uploadedPath]);
      if (error) console.warn("Unable to remove an unsaved review photo:", error.message);
    } catch { console.warn("Unable to remove an unsaved review photo."); }
    uploadedPath = null;
  }
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
    let body: Record<string, unknown> | null = null;
    let image: File | null = null;
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData().catch(() => null);
      if (!form) return NextResponse.json({ error: "Unable to read the review form. Please try again." }, { status: 400 });
      const payload = form.get("review");
      const attachment = form.get("image");
      if (form.getAll("image").length > 1 || (attachment !== null && !(attachment instanceof File))) {
        return NextResponse.json({ error: "Attach only one photo to your review." }, { status: 400 });
      }
      if (attachment instanceof File) image = attachment;
      if (typeof payload === "string") {
        try { body = JSON.parse(payload); } catch { /* Invalid review payload is rejected below. */ }
      }
    } else {
      body = await request.json().catch(() => null);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Enter valid review details." }, { status: 400 });
    }
    if (image && (!image.size || image.size > REVIEW_IMAGE_MAX_BYTES)) {
      return NextResponse.json({ error: REVIEW_IMAGE_HELP }, { status: 400 });
    }
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
      if (rating != null && (!Number.isInteger(rating) || Number(rating) < 1 || Number(rating) > 5)) {
        return NextResponse.json(
          { error: "All ratings must be between 1 and 5." },
          { status: 400 }
        );
      }
    }

    // Validate title and review length
    if (typeof title !== "string" || title.trim().length === 0 || title.trim().length > 200) {
      return NextResponse.json(
        { error: "Enter a review title between 1 and 200 characters." },
        { status: 400 }
      );
    }

    if (typeof review_text !== "string" || review_text.trim().length < 50 || review_text.trim().length > 5000) {
      return NextResponse.json(
        {
          error: "Review text must be between 50 and 5,000 characters long.",
        },
        { status: 400 }
      );
    }

    if (would_recommend != null && typeof would_recommend !== "boolean") {
      return NextResponse.json({ error: "Choose whether you would recommend the resort." }, { status: 400 });
    }
    if (reservation_id != null && (typeof reservation_id !== "string" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(reservation_id))) {
      return NextResponse.json({ error: "Enter a valid reservation ID or leave it blank." }, { status: 400 });
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

    if (image) {
      const bytes = new Uint8Array(await image.arrayBuffer());
      const extension = contentImageExtension(bytes, image.type);
      if (!extension) return NextResponse.json({ error: REVIEW_IMAGE_HELP }, { status: 400 });
      storage = createAdminClient().storage.from(REVIEW_IMAGE_BUCKET);
      const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
      const { error: uploadError } = await storage.upload(path, bytes, { contentType: image.type, upsert: false });
      if (uploadError) {
        console.warn("Review photo upload failed:", uploadError.message);
        return NextResponse.json({ error: "Unable to upload your photo. Please try again or submit your review without a photo." }, { status: 503 });
      }
      uploadedPath = path;
    }

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
        ...(uploadedPath ? { image_path: uploadedPath } : {}),
      })
      .select()
      .single();

    if (insertError || !newReview) {
      await removeUpload();
      console.error("Review insertion error:", insertError);
      if (insertError?.code === "23505") return NextResponse.json({ error: "You have already submitted a review. Each guest can only submit one review." }, { status: 409 });
      if (insertError?.code === "PGRST204" || insertError?.code === "42703") return NextResponse.json({ error: "Review photos are temporarily unavailable. Please try again later or submit your review without a photo." }, { status: 503 });
      return NextResponse.json(
        { error: "Failed to create review. Please try again." },
        { status: 500 }
      );
    }
    uploadedPath = null; // The saved review now owns the attachment.

    const { error: notificationError } = await createNotifications({
      actorId: user.id,
      guestId: user.id,
      staffRoles: NOTIFICATION_AUDIENCES.review,
      title: "Review submitted",
      message: "Thanks for sharing your experience.",
      entityType: "review",
      entityId: newReview.review_id,
      guestActionUrl: "/reviews",
      staffActionUrl: "/admin",
    }).catch(() => ({ error: "Review notification unavailable" }));

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
    await removeUpload();
    console.error("Review endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error. Please try again later." },
      { status: 500 }
    );
  }
}
