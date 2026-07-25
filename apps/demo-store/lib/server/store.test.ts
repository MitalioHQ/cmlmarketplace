import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { StoredPreview } from "./store";
import { MemoryCommerceStore } from "./store";

const preview: StoredPreview = {
  id: "preview_test",
  customerId: 42,
  request: {
    channelSlug: "northstar",
    customer: {
      email: "customer@example.com",
      firstName: "Mina",
      lastName: "Vein",
    },
    items: [{ productId: "15", quantity: 1 }],
  },
  cmlOrder: {
    customer_id: 42,
    sales_channel: "northstar",
    items: [{ product_id: 15, qty: 1 }],
  },
  preview: {
    id: "preview_test",
    channel: {
      id: "channel_northstar",
      slug: "northstar",
      displayName: "Northstar",
    },
    customer: {
      email: "customer@example.com",
      firstName: "Mina",
      lastName: "Vein",
    },
    items: [],
    totals: {
      subtotal: { amountMinor: 9_900, currency: "USD" },
      discount: { amountMinor: 0, currency: "USD" },
      total: { amountMinor: 9_900, currency: "USD" },
    },
    warnings: [],
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe("MemoryCommerceStore", () => {
  it("serializes customer creation and preserves the CML customer ID", async () => {
    const store = new MemoryCommerceStore();
    const claim = await store.claimCustomer(
      "northstar",
      "customer@example.com",
    );

    expect(claim.kind).toBe("claimed");
    expect(
      await store.claimCustomer("northstar", "customer@example.com"),
    ).toEqual({ kind: "busy" });

    if (claim.kind !== "claimed") {
      throw new Error("Expected a customer claim.");
    }

    await store.completeCustomerClaim(
      "northstar",
      "customer@example.com",
      claim.token,
      42,
    );
    expect(
      await store.claimCustomer("northstar", "customer@example.com"),
    ).toEqual({ kind: "existing", customerId: 42 });
  });

  it("atomically claims and completes a preview", async () => {
    const store = new MemoryCommerceStore();
    await store.savePreview(preview);
    const claim = await store.claimPreview(preview.id);

    expect(claim.kind).toBe("claimed");
    expect(await store.claimPreview(preview.id)).toEqual({ kind: "busy" });

    if (claim.kind !== "claimed") {
      throw new Error("Expected a preview claim.");
    }

    const order = {
      id: "114",
      code: "ORD114",
      status: "pending_payment" as const,
      fulfillmentStatus: "not_started" as const,
      customerId: "42",
      channel: preview.preview.channel,
      items: preview.preview.items,
      totals: preview.preview.totals,
      amountPaid: { amountMinor: 0, currency: "USD" },
      amountDue: { amountMinor: 9_900, currency: "USD" },
      createdAt: new Date().toISOString(),
    };
    await store.completePreview(preview.id, claim.token, order);

    expect(await store.claimPreview(preview.id)).toEqual({
      kind: "completed",
      order,
    });
  });

  it("enforces fixed-window rate limits", async () => {
    const store = new MemoryCommerceStore();
    expect(await store.consumeRateLimit("preview:test", 2, 60)).toBe(true);
    expect(await store.consumeRateLimit("preview:test", 2, 60)).toBe(true);
    expect(await store.consumeRateLimit("preview:test", 2, 60)).toBe(false);
  });
});
