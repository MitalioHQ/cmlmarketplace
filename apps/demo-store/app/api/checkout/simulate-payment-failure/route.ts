import { simulatePaymentFailure } from "../../../../lib/server/commerce";
import {
  errorResponse,
  jsonResponse,
} from "../../../../lib/server/errors";
import { readJson } from "../../../../lib/server/request";
import {
  parseInput,
  paymentRequestSchema,
} from "../../../../lib/server/schemas";
import { enforceMutationRequest } from "../../../../lib/server/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    await enforceMutationRequest(
      request,
      "simulate-payment-failure",
      5,
    );
    const input = parseInput(
      paymentRequestSchema,
      await readJson(request),
    );
    return jsonResponse(await simulatePaymentFailure(input.orderId));
  } catch (error) {
    return errorResponse(error);
  }
}
