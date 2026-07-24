import { readCmlResponse, type Catalog } from "@cml-marketplace/core";

export interface CatalogRequest {
  channelSlug: string;
  countryCode?: string;
}

export interface CatalogClient {
  getCatalog(
    request: CatalogRequest,
    options?: { signal?: AbortSignal },
  ): Promise<Catalog>;
}

export interface CatalogClientConfig {
  baseUrl: string;
  path?: string;
  headers?: Readonly<Record<string, string>>;
  fetch?: typeof globalThis.fetch;
}

export function createCatalogClient(
  config: CatalogClientConfig,
): CatalogClient {
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const path = normalizePath(config.path ?? "/api/catalog");

  if (!fetchImplementation) {
    throw new TypeError("A Fetch API implementation is required.");
  }

  return {
    async getCatalog(request, options) {
      const channelSlug = request.channelSlug.trim();

      if (!channelSlug) {
        throw new TypeError("A sales-channel slug is required.");
      }

      const countryCode = normalizeCountryCode(request.countryCode);
      const query = new URLSearchParams({ channel: channelSlug });
      if (countryCode) {
        query.set("country", countryCode);
      }
      const response = await fetchImplementation(
        `${baseUrl}${path}?${query.toString()}`,
        {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...config.headers,
        },
        ...(options?.signal ? { signal: options.signal } : {}),
        },
      );

      return readCmlResponse<Catalog>(response);
    },
  };
}

function normalizeCountryCode(
  countryCode: string | undefined,
): string | undefined {
  const normalized = countryCode?.trim().toUpperCase();

  if (!normalized) {
    return undefined;
  }

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new TypeError("Country code must be an ISO alpha-2 code.");
  }

  return normalized;
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");

  if (!/^https?:\/\//.test(normalized) && !normalized.startsWith("/")) {
    throw new TypeError("baseUrl must be an HTTP(S) URL or absolute path.");
  }

  return normalized;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
