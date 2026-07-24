import { describe, expect, it, vi } from "vitest";

import { createCatalogClient } from "./catalog-client.js";

describe("catalog client", () => {
  it("normalizes channel-country requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          channel: {
            id: "channel_1",
            slug: "demo",
            displayName: "Demo",
          },
          available: true,
          products: [],
          fetchedAt: new Date(0).toISOString(),
        }),
        { status: 200 },
      ),
    );
    const client = createCatalogClient({
      baseUrl: "https://merchant.example.test/",
      fetch: fetchMock,
    });

    await client.getCatalog({
      channelSlug: " northstar ",
      countryCode: "lb",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://merchant.example.test/api/catalog?channel=northstar&country=LB",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
        }),
      }),
    );
  });

  it("returns stable API errors", async () => {
    const client = createCatalogClient({
      baseUrl: "/api/cml",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "channel_restricted",
              message: "This country is not available.",
            },
          }),
          { status: 403 },
        ),
      ),
    });

    await expect(
      client.getCatalog({ channelSlug: "demo", countryCode: "US" }),
    ).rejects.toMatchObject({
      code: "channel_restricted",
      status: 403,
      retryable: false,
    });
  });
});
