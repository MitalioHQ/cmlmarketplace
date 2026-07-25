import { describe, expect, it, vi } from "vitest";

import {
  createCmlApiClient,
  createCmlRequestSignature,
} from "./server-client.js";

describe("CML server client", () => {
  it("signs the exact JSON body with the CML HMAC contract", () => {
    expect(
      createCmlRequestSignature({
        apiKey: "key_test",
        apiSecret: "secret_test",
        timestamp: "1700000000",
        rawBody: '{"channel":"northstar","country_code":"FR"}',
      }),
    ).toBe("Z7mnTfTKgSI6YhmF0H1ycymF/74pKKDyNSThITOfCkE=");
  });

  it("calls the documented catalog endpoint with signed headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: {
            available: true,
            channel: { slug: "northstar", display_name: "Northstar" },
            products: [],
          },
        }),
        { status: 200 },
      ),
    );
    const client = createCmlApiClient({
      apiKey: "key_test",
      apiSecret: "secret_test",
      baseUrl: "https://api.example.test/v1/",
      fetch: fetchMock,
      now: () => 1_700_000_000_000,
    });

    await client.getCatalog({
      channel: "northstar",
      country_code: "FR",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/sales-channel/catalog",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "key_test",
          "X-API-Timestamp": "1700000000",
          "X-API-Signature": expect.any(String),
        }),
        body: '{"channel":"northstar","country_code":"FR"}',
      }),
    );
    expect(
      (
        fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>
      ).Authorization,
    ).toBeUndefined();
  });

  it("submits, confirms, and cancels an order using the documented paths", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
      );
    const client = createCmlApiClient({
      apiKey: "key_test",
      apiSecret: "secret_test",
      baseUrl: "https://api.example.test/v1",
      fetch: fetchMock,
    });
    const order = {
      customer_id: 42,
      sales_channel: "northstar",
      items: [{ product_id: 15, qty: 1 }],
    };

    await client.submitOrder(order);
    await client.confirmOrder(114);
    await client.cancelOrder({
      order_id: 114,
      notes: "Provider payment failed",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/v1/order/submit",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ order }),
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.example.test/v1/order/confirm",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({ order_id: 114 }),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://api.example.test/v1/order/cancel",
    );
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        order_id: 114,
        notes: "Provider payment failed",
      }),
    );
  });
});
