import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { REVIEW_IMAGE_BUCKET } from "@/lib/reviews/images";

interface ReviewRow {
  review_id: string;
  public_display_name: string | null;
  overall_rating: number;
  cleanliness_rating: number | null;
  service_rating: number | null;
  amenities_rating: number | null;
  value_rating: number | null;
  title: string;
  review_text: string;
  would_recommend: boolean | null;
  created_at: string;
  image_path: string | null;
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get("limit") || "10", 10);
    const offsetParam = parseInt(searchParams.get("offset") || "0", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 100)
      : 10;
    const offset = Number.isFinite(offsetParam) ? Math.max(offsetParam, 0) : 0;
    const guestId = searchParams.get("guest_id");
    const reservationId = searchParams.get("reservation_id");

    let query = supabase
      .from("reviews")
      .select(
        `
        review_id,
        overall_rating,
        cleanliness_rating,
        service_rating,
        amenities_rating,
        value_rating,
        title,
        review_text,
        public_display_name,
        would_recommend,
        created_at,
        image_path
      `,
        { count: "exact" }
      )
      .eq("is_approved", true)
      .order("created_at", { ascending: false });

    // Optional filters
    if (guestId) {
      query = query.eq("guest_id", guestId);
    }

    if (reservationId) {
      query = query.eq("reservation_id", reservationId);
    }

    // Pagination
    query = query.range(offset, offset + limit - 1);

    const { data: reviews, error: fetchError, count } = await query;

    if (fetchError) {
      console.error("Review fetch error:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch reviews." },
        { status: 500 }
      );
    }

    const paths = (reviews as ReviewRow[] | null)?.flatMap(review => review.image_path ? [review.image_path] : []) ?? [];
    const imageUrls = new Map<string, string>();
    if (paths.length) {
      try {
        const { data, error } = await supabase.storage.from(REVIEW_IMAGE_BUCKET).createSignedUrls(paths, 3600);
        if (error) console.warn("Unable to load review photos:", error.message);
        for (const image of data ?? []) if (image.path && image.signedUrl && !image.error) imageUrls.set(image.path, image.signedUrl);
      } catch { console.warn("Unable to load review photos."); }
    }

    // Format response without exposing guest IDs or storage paths.
    const formattedReviews = (reviews as ReviewRow[] | null)?.map((review) => ({
      review_id: review.review_id,
      guest_name: review.public_display_name || "Verified Guest",
      overall_rating: review.overall_rating,
      cleanliness_rating: review.cleanliness_rating,
      service_rating: review.service_rating,
      amenities_rating: review.amenities_rating,
      value_rating: review.value_rating,
      title: review.title,
      review_text: review.review_text,
      would_recommend: review.would_recommend,
      created_at: review.created_at,
      image_url: review.image_path ? imageUrls.get(review.image_path) ?? null : null,
    }));

    return NextResponse.json(
      {
        reviews: formattedReviews,
        pagination: {
          total: count,
          limit,
          offset,
          returned: reviews?.length || 0,
        },
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Reviews GET endpoint error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
