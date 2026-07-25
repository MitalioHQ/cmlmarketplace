import { createPreview } from "../../../../lib/server/commerce";
import {
  errorResponse,
  jsonResponse,
} from "../../../../lib/server/errors";
import { readJson } from "../../../../lib/server/request";
import {
  parseInput,
  previewRequestSchema,
} from "../../../../lib/server/schemas";
import { enforceMutationRequest } from "../../../../lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceMutationRequest(request, "checkout-preview", 10);
    const input = parseInput(
      previewRequestSchema,
      await readJson(request),
    );
    return jsonResponse(await createPreview(input));
  } catch (error) {
    return errorResponse(error);
  }
}
