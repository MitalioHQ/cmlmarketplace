import "server-only";

import { createHash } from "node:crypto";

import { HttpError } from "./errors";
import { readEnvironment } from "./environment";

const MAX_BODY_BYTES = 1_000_000;

export async function readJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);

  if (declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(
      413,
      "request_too_large",
      "Request body is too large.",
    );
  }

  const buffer = await request.arrayBuffer();

  if (buffer.byteLength > MAX_BODY_BYTES) {
    throw new HttpError(
      413,
      "request_too_large",
      "Request body is too large.",
    );
  }

  try {
    return JSON.parse(new TextDecoder().decode(buffer) || "{}") as unknown;
  } catch {
    throw new HttpError(
      400,
      "invalid_json",
      "Request body must be valid JSON.",
    );
  }
}

export function assertAllowedOrigin(request: Request): void {
  const environment = readEnvironment();
  const originHeader = request.headers.get("origin");

  if (!originHeader) {
    if (environment.production) {
      throw new HttpError(
        403,
        "origin_required",
        "A trusted request origin is required.",
      );
    }
    return;
  }

  const origin = normalizeOrigin(originHeader);
  const allowed = new Set<string>();

  addOrigin(allowed, request.url);
  for (const configuredOrigin of environment.allowedOrigins) {
    addOrigin(allowed, configuredOrigin);
  }

  const forwardedProtocol = firstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const requestProtocol = new URL(request.url).protocol.replace(/:$/, "");
  const publicProtocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? forwardedProtocol
      : requestProtocol;

  for (const hostHeader of [
    request.headers.get("host"),
    request.headers.get("x-forwarded-host"),
  ]) {
    const host = firstHeaderValue(hostHeader);
    if (host) {
      addOrigin(allowed, `${publicProtocol}://${host}`);
    }
  }

  if (!origin || !allowed.has(origin)) {
    throw new HttpError(
      403,
      "origin_not_allowed",
      "This request origin is not allowed.",
    );
  }
}

function addOrigin(origins: Set<string>, value: string): void {
  const origin = normalizeOrigin(value);
  if (origin) {
    origins.add(origin);
  }
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

function firstHeaderValue(value: string | null): string | undefined {
  return value?.split(",")[0]?.trim() || undefined;
}

export function assertMutationsEnabled(): void {
  if (!readEnvironment().mutationsEnabled) {
    throw new HttpError(
      403,
      "demo_mutations_disabled",
      "Live demo checkout mutations are disabled.",
    );
  }
}

export function getRateLimitKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const address =
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const digest = createHash("sha256").update(address).digest("hex");
  return `${scope}:${digest}`;
}
