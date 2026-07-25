import { getDemoConfig } from "../../../lib/server/commerce";
import {
  errorResponse,
  jsonResponse,
} from "../../../lib/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  try {
    return jsonResponse(getDemoConfig());
  } catch (error) {
    return errorResponse(error);
  }
}
