import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
	try {
		const supabase = await createClient();

		const { data, error } = await supabase
			.from("services")
			.select("service_id, name, description, price")
			.eq("is_active", true)
			.order("name", { ascending: true });

		if (error) {
			return NextResponse.json(
				{
					success: false,
					message: "Failed to load resort services.",
				},
				{ status: 500 }
			);
		}

		return NextResponse.json(
			{
				success: true,
				services: data ?? [],
			},
			{ status: 200 }
		);
	} catch {
		return NextResponse.json(
			{
				success: false,
				message: "Unexpected error while fetching resort services.",
			},
			{ status: 500 }
		);
	}
}
