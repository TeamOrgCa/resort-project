import { reviewOcularVisit } from "@/lib/server/ocular-review";
export const POST = (request: Request) => reviewOcularVisit(request, "approve");
