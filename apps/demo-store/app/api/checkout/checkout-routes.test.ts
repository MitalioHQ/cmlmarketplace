import type { CmlApiClient } from "@cml-marketplace/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { POST as confirm } from "./confirm/route";
import { POST as preview } from "./preview/route";
import { POST as simulatePayment } from "./simulate-payment/route";
import { POST as simulatePaymentFailure } from "./simulate-payment-failure/route";
import { setCmlClientForTesting } from "../../../lib/server/commerce";
import {
  MemoryCommerceStore,
  setCommerceStoreForTesting,
} from "../../../lib/server/store";

describe("checkout Route Handlers", () => {
  let paid = false;
  let cancelled = false;
  let cml: CmlApiClient;

  beforeEach(() => {
    process.env.CML_API_KEY = "key_test";
    process.env.CML_API_SECRET = "secret_test";
    process.env.CML_CHANNEL_SLUG = "northstar";
    process.env.CML_DEFAULT_COUNTRY = "FR";
    process.env.CML_DEMO_MUTATIONS_ENABLED = "true";
    paid = false;
    cancelled = false;

    cml = {
      getCatalog: vi.fn(async () => ({
        success: {
          available: true,
          country_code: "FR",
          channel: {
            slug: "northstar",
            display_name: "Northstar",
          },
          products: [
            {
              product_id: 15,
              price: "99.00",
              currency: "USD",
              product: {
                id: 15,
                code: "CML-15",
                title: "CML Product",
              },
              program: { name: "Software" },
            },
          ],
        },
      })),
      createCustomer: vi.fn(async () => ({
        success: { customer: { id: 42 } },
      })),
      previewOrder: vi.fn(async () => ({
        success: {
          data: {
            order: {
              original_amount: "99.00",
              discount_amount: "0.00",
              final_amount: "99.00",
              currency: "USD",
            },
          },
        },
      })),
      submitOrder: vi.fn(async () => ({
        success: {
          data: {
            order: {
              id: 114,
              code: "ORD114",
              status: 0,
              original_amount: "99.00",
              final_amount: "99.00",
              currency: "USD",
            },
          },
        },
      })),
      confirmOrder: vi.fn(async () => ({ success: true })),
      getOrder: vi.fn(async () => ({
        success: {
          data: {
            order: {
              id: 114,
              code: "ORD114",
              status: cancelled ? 4 : paid ? 3 : 1,
              original_amount: "99.00",
              final_amount: "99.00",
              currency: "USD",
            },
          },
        },
      })),
      recordPayment: vi.fn(async (payment) => {
        if (payment.status === 1) {
          paid = true;
        }
        return { success: true };
      }),
      cancelOrder: vi.fn(async () => {
        cancelled = true;
        return { success: true };
      }),
    };

    setCmlClientForTesting(cml);
    setCommerceStoreForTesting(new MemoryCommerceStore());
  });

  afterEach(() => {
    setCmlClientForTesting(undefined);
    setCommerceStoreForTesting(undefined);
    delete process.env.CML_API_KEY;
    delete process.env.CML_API_SECRET;
    delete process.env.CML_CHANNEL_SLUG;
    delete process.env.CML_DEFAULT_COUNTRY;
    delete process.env.CML_DEMO_MUTATIONS_ENABLED;
  });

  it("previews, confirms idempotently, and records a payment", async () => {
    const previewResponse = await preview(
      post("/api/checkout/preview", {
        channelSlug: "northstar",
        customer: {
          email: "customer@example.com",
          firstName: "Mina",
          lastName: "Vein",
          countryCode: "FR",
        },
        items: [{ productId: "15", quantity: 1 }],
      }),
    );
    expect(previewResponse.status).toBe(200);
    const previewBody = (await previewResponse.json()) as { id: string };

    const confirmResponse = await confirm(
      post("/api/checkout/confirm", {
        previewId: previewBody.id,
      }),
    );
    expect(confirmResponse.status).toBe(200);
    const order = (await confirmResponse.json()) as {
      id: string;
      status: string;
    };
    expect(order).toMatchObject({ id: "114", status: "pending_payment" });

    const retryResponse = await confirm(
      post("/api/checkout/confirm", {
        previewId: previewBody.id,
      }),
    );
    expect(retryResponse.status).toBe(200);
    expect(cml.submitOrder).toHaveBeenCalledTimes(1);

    const paymentResponse = await simulatePayment(
      post("/api/checkout/simulate-payment", { orderId: order.id }),
    );
    expect(paymentResponse.status).toBe(200);
    expect(await paymentResponse.json()).toMatchObject({
      simulated: true,
      recordedInCml: true,
      liveOrderStatus: "paid",
    });
  });

  it("rejects mutation requests when the safety flag is disabled", async () => {
    process.env.CML_DEMO_MUTATIONS_ENABLED = "false";
    const response = await preview(
      post("/api/checkout/preview", {}),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "demo_mutations_disabled",
        message: "Live demo checkout mutations are disabled.",
      },
    });
  });

  it("records a failed payment and cancels the unpaid CML order", async () => {
    const previewResponse = await preview(
      post("/api/checkout/preview", {
        channelSlug: "northstar",
        customer: {
          email: "declined@example.com",
          firstName: "Dalia",
          lastName: "Mansour",
          countryCode: "FR",
        },
        items: [{ productId: "15", quantity: 1 }],
      }),
    );
    const previewBody = (await previewResponse.json()) as { id: string };
    const confirmResponse = await confirm(
      post("/api/checkout/confirm", {
        previewId: previewBody.id,
      }),
    );
    const order = (await confirmResponse.json()) as { id: string };

    const failureResponse = await simulatePaymentFailure(
      post("/api/checkout/simulate-payment-failure", {
        orderId: order.id,
      }),
    );

    expect(failureResponse.status).toBe(200);
    expect(await failureResponse.json()).toMatchObject({
      simulated: true,
      failedPaymentRecordedInCml: true,
      cancelledInCml: true,
      liveOrderStatus: "cancelled",
      order: { status: "cancelled" },
    });
    expect(cml.recordPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        order_code: "ORD114",
        amount: "99.00",
        status: 2,
      }),
    );
    expect(cml.cancelOrder).toHaveBeenCalledWith({
      order_id: 114,
      notes: "Demo provider payment failed before capture.",
    });
  });
});

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}
