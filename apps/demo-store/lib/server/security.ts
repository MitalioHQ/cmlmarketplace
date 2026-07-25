import "server-only";

import { HttpError } from "./errors";
import {
  assertAllowedOrigin,
  assertMutationsEnabled,
  getRateLimitKey,
} from "./request";
import { getCommerceStore } from "./store";

export async function enforceMutationRequest(
  request: Request,
  scope: string,
  limit: number,
): Promise<void> {
  assertMutationsEnabled();
  assertAllowedOrigin(request);
  const store = await getCommerceStore();
  const allowed = await store.consumeRateLimit(
    getRateLimitKey(request, scope),
    limit,
    10 * 60,
  );

  if (!allowed) {
    throw new HttpError(
      429,
      "rate_limit_exceeded",
      "Too many checkout requests. Try again later.",
    );
  }
}
