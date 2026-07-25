import type {
  Catalog,
  CommerceOrder,
  OrderPreview,
  OrderPreviewRequest,
} from "@cml-marketplace/core";

export interface DemoConfig {
  cmlConfigured: boolean;
  checkoutConfigured: boolean;
  mutationsEnabled: boolean;
  channelSlug: string;
  defaultCountry: string;
  catalogMode: "live" | "unconfigured";
  paymentMode: "simulation_with_live_cml_mutations";
}

export interface SimulatedPaymentResult {
  simulated: true;
  recordedInCml: true;
  liveOrderStatus: CommerceOrder["status"];
  order: CommerceOrder;
}

export interface SimulatedPaymentFailureResult {
  simulated: true;
  failedPaymentRecordedInCml: true;
  cancelledInCml: true;
  liveOrderStatus: CommerceOrder["status"];
  order: CommerceOrder;
}

export class DemoApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "DemoApiError";
    this.status = status;
    this.code = code;
  }
}

export class DemoCommerceGateway {
  async getConfig(): Promise<DemoConfig> {
    return request<DemoConfig>("/api/config");
  }

  async getCatalog(countryCode: string): Promise<Catalog> {
    return request<Catalog>(
      `/api/catalog?country=${encodeURIComponent(countryCode)}`,
    );
  }

  async previewOrder(input: OrderPreviewRequest): Promise<OrderPreview> {
    return request<OrderPreview>("/api/checkout/preview", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async confirmOrder(previewId: string): Promise<CommerceOrder> {
    return request<CommerceOrder>("/api/checkout/confirm", {
      method: "POST",
      body: JSON.stringify({ previewId }),
    });
  }

  async simulatePayment(orderId: string): Promise<SimulatedPaymentResult> {
    return request<SimulatedPaymentResult>(
      "/api/checkout/simulate-payment",
      {
        method: "POST",
        body: JSON.stringify({ orderId }),
      },
    );
  }

  async simulatePaymentFailure(
    orderId: string,
  ): Promise<SimulatedPaymentFailureResult> {
    return request<SimulatedPaymentFailureResult>(
      "/api/checkout/simulate-payment-failure",
      {
        method: "POST",
        body: JSON.stringify({ orderId }),
      },
    );
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => undefined)) as
    | {
        error?: { code?: string; message?: string };
      }
    | T
    | undefined;

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body
        ? body.error?.message
        : undefined;
    const code =
      body && typeof body === "object" && "error" in body
        ? body.error?.code
        : undefined;
    throw new DemoApiError(
      response.status,
      code || `http_${response.status}`,
      message || `The demo API returned HTTP ${response.status}.`,
    );
  }

  return body as T;
}
