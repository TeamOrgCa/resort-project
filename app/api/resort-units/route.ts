import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
	try {
		const supabase = await createClient();

		const { data, error } = await supabase
			.from("units")
			.select("unit_id, unit_img, name, description, capacity, base_price")
			.eq("is_active", true)
			.is("archived_at", null)
			.order("name", { ascending: true });

		if (error) {
			return NextResponse.json(
				{
					success: false,
					message: "Failed to load resort units.",
				},
				{ status: 500 }
			);
		}

		return NextResponse.json(
			{
				success: true,
				units: data ?? [],
			},
			{ status: 200 }
		);
	} catch {
		return NextResponse.json(
			{
				success: false,
				message: "Unexpected error while fetching resort units.",
			},
			{ status: 500 }
		);
	}
}
