import { confirmPreview } from "../../../../lib/server/commerce";
import {
  errorResponse,
  jsonResponse,
} from "../../../../lib/server/errors";
import { readJson } from "../../../../lib/server/request";
import {
  confirmRequestSchema,
  parseInput,
} from "../../../../lib/server/schemas";
import { enforceMutationRequest } from "../../../../lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceMutationRequest(request, "checkout-confirm", 10);
    const input = parseInput(
      confirmRequestSchema,
      await readJson(request),
    );
    return jsonResponse(await confirmPreview(input.previewId));
  } catch (error) {
    return errorResponse(error);
  }
}
