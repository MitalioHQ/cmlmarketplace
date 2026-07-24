export interface CmlErrorBody {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: unknown;
  };
}

export class CmlApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(options: {
    code: string;
    message: string;
    status: number;
    requestId?: string;
    details?: unknown;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "CmlApiError";
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
    this.retryable =
      options.retryable ??
      (options.status === 429 || options.status >= 500);
  }
}

export async function readCmlResponse<T>(response: Response): Promise<T> {
  const body = await readJsonBody(response);

  if (!response.ok) {
    const errorBody = isRecord(body) ? (body as CmlErrorBody) : undefined;
    const apiError = errorBody?.error;

    throw new CmlApiError({
      code: apiError?.code ?? `http_${response.status}`,
      message:
        apiError?.message ??
        `CML returned an unsuccessful HTTP ${response.status} response.`,
      status: response.status,
      ...(apiError?.requestId ? { requestId: apiError.requestId } : {}),
      ...(apiError?.details !== undefined ? { details: apiError.details } : {}),
    });
  }

  return body as T;
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CmlApiError({
      code: "invalid_response",
      message: "CML returned a response that was not valid JSON.",
      status: response.status,
      retryable: response.status >= 500,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
