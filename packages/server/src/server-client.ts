import { createHash, createHmac } from "node:crypto";

import { readCmlResponse } from "@cml-marketplace/core";

export const CML_API_BASE_URL =
  "https://vwqretlvkrravzguxydw.functions.eu-west-2.nhost.run/v1";

export interface CmlCustomerInput {
  email: string;
  first_name: string;
  last_name: string;
  type?: "Individual" | "Business";
  postal_code?: string;
  country_code?: string;
  state?: string;
  address?: string;
  phone?: string;
  tax_id?: string;
  referee?: boolean;
}

export interface CmlOrderItemInput {
  product_id: number;
  qty: number;
  metadata?: {
    specific_rules: {
      type: string;
      target_id?: string;
      target_host?: string;
    };
  };
}

export interface CmlOrderInput {
  customer_id: number;
  sales_channel: string;
  referral_code?: string;
  items: CmlOrderItemInput[];
}

export interface CmlPaymentInput {
  order_code: string;
  provider: string;
  provider_txn_id: string;
  amount: number | string;
  status: 1 | 2 | 3;
  payment_method?: string;
}

export interface CmlApiClient {
  getCatalog(request: {
    channel: string;
    country_code: string;
  }): Promise<unknown>;
  createCustomer(customer: CmlCustomerInput): Promise<unknown>;
  previewOrder(order: CmlOrderInput): Promise<unknown>;
  submitOrder(order: CmlOrderInput): Promise<unknown>;
  confirmOrder(orderId: number): Promise<unknown>;
  getOrder(orderCode: string): Promise<unknown>;
  recordPayment(payment: CmlPaymentInput): Promise<unknown>;
}

export interface CmlApiClientConfig {
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  allowBrowserForTesting?: boolean;
}

export function createCmlApiClient(config: CmlApiClientConfig): CmlApiClient {
  if (
    !config.allowBrowserForTesting &&
    typeof globalThis.window !== "undefined"
  ) {
    throw new Error(
      "@cml-marketplace/server cannot be initialized in a browser. " +
        "Keep the CML API secret in a server route.",
    );
  }

  const apiKey = config.apiKey.trim();
  const apiSecret = config.apiSecret.trim();
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? CML_API_BASE_URL);
  const fetchImplementation = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  if (!apiKey) {
    throw new TypeError("A CML API key is required.");
  }

  if (!apiSecret) {
    throw new TypeError("A CML API secret is required.");
  }

  if (!fetchImplementation) {
    throw new TypeError("A Fetch API implementation is required.");
  }

  const post = async <T>(path: string, body: unknown): Promise<T> => {
    const rawBody = JSON.stringify(body);
    const timestamp = Math.floor(now() / 1000).toString();
    const signature = createCmlRequestSignature({
      apiKey,
      apiSecret,
      timestamp,
      rawBody,
    });
    const response = await fetchImplementation(
      `${baseUrl}${normalizePath(path)}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-API-Timestamp": timestamp,
          "X-API-Signature": signature,
        },
        body: rawBody,
      },
    );

    return readCmlResponse<T>(response);
  };

  return {
    getCatalog(request) {
      return post("/sales-channel/catalog", request);
    },

    createCustomer(customer) {
      return post("/order/customer", { customer });
    },

    previewOrder(order) {
      return post("/order/submit", { preview: true, order });
    },

    submitOrder(order) {
      return post("/order/submit", { order });
    },

    confirmOrder(orderId) {
      assertPositiveInteger(orderId, "order ID");
      return post("/order/confirm", { order_id: orderId });
    },

    getOrder(orderCode) {
      const normalizedCode = orderCode.trim();

      if (!normalizedCode) {
        throw new TypeError("An order code is required.");
      }

      return post("/order/get", { order_code: normalizedCode });
    },

    recordPayment(payment) {
      return post("/order/payment", { payment });
    },
  };
}

export function createCmlRequestSignature(input: {
  apiKey: string;
  apiSecret: string;
  timestamp: string;
  rawBody: string;
}): string {
  const bodyHex = createHash("sha256")
    .update(input.rawBody, "utf8")
    .digest("hex");
  const canonical = `${input.apiKey}.${input.timestamp}.${bodyHex}`;

  return createHmac("sha256", input.apiSecret)
    .update(canonical, "utf8")
    .digest("base64");
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`A positive integer ${label} is required.`);
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");

  if (!/^https?:\/\//.test(normalized)) {
    throw new TypeError("CML baseUrl must be an HTTP(S) URL.");
  }

  return normalized;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
