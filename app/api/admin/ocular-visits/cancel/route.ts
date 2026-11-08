import { cancelManagerOcularVisit } from "@/lib/server/ocular-cancellation";
export const POST = (request: Request) => cancelManagerOcularVisit(request);
