import { getCatalog } from "../../../lib/server/commerce";
import {
  errorResponse,
  jsonResponse,
} from "../../../lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const country = new URL(request.url).searchParams.get("country") ?? "";
    return jsonResponse(await getCatalog(country));
  } catch (error) {
    return errorResponse(error);
  }
}
