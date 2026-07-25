import "server-only";

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function errorResponse(error: unknown): Response {
  const status = getErrorStatus(error);
  const code =
    error instanceof HttpError
      ? error.code
      : hasErrorCode(error)
        ? String(error.code)
        : "internal_error";
  const message =
    status >= 500 && !(error instanceof HttpError)
      ? "An unexpected server error occurred."
      : error instanceof Error
        ? error.message
        : "An unexpected server error occurred.";

  if (status >= 500) {
    console.error("Demo API request failed", error);
  }

  return jsonResponse({ error: { code, message } }, status);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getErrorStatus(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status;
  }

  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    Number.isInteger(Number(error.status))
  ) {
    const status = Number(error.status);
    return status >= 400 && status <= 599 ? status : 500;
  }

  return 500;
}

function hasErrorCode(error: unknown): error is { code: unknown } {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code,
  );
}
