import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCatalog } from "@/repositories/catalogRepository";

export async function GET() {
	try {
		const supabase = await createClient();

		const { units } = await getActiveCatalog(supabase);

		return NextResponse.json(
			{
				success: true,
				units,
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
