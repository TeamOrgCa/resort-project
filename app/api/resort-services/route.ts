import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCatalog } from "@/repositories/catalogRepository";

export async function GET() {
	try {
		const supabase = await createClient();

		const { services } = await getActiveCatalog(supabase);

		return NextResponse.json(
			{
				success: true,
				services,
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
