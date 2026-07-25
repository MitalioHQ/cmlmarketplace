import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { HttpError } from "./errors";
import { assertAllowedOrigin } from "./request";

describe("checkout request origin validation", () => {
  const originalAllowedOrigins = process.env.CML_ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalAllowedOrigins === undefined) {
      delete process.env.CML_ALLOWED_ORIGINS;
    } else {
      process.env.CML_ALLOWED_ORIGINS = originalAllowedOrigins;
    }
  });

  it("accepts the public Vercel origin when the function URL is internal", () => {
    const request = new Request(
      "http://internal-function.local/api/checkout/preview",
      {
        headers: {
          Origin: "https://store.example.com",
          Host: "store.example.com",
          "X-Forwarded-Host": "store.example.com",
          "X-Forwarded-Proto": "https",
        },
      },
    );

    expect(() => assertAllowedOrigin(request)).not.toThrow();
  });

  it("normalizes explicitly configured origins", () => {
    process.env.CML_ALLOWED_ORIGINS = "https://trusted.example.com/";
    const request = new Request(
      "http://internal-function.local/api/checkout/preview",
      {
        headers: {
          Origin: "https://trusted.example.com",
        },
      },
    );

    expect(() => assertAllowedOrigin(request)).not.toThrow();
  });

  it("still rejects an origin that is neither same-origin nor configured", () => {
    process.env.CML_ALLOWED_ORIGINS = "https://trusted.example.com";
    const request = new Request(
      "http://internal-function.local/api/checkout/preview",
      {
        headers: {
          Origin: "https://attacker.example",
          Host: "store.example.com",
          "X-Forwarded-Proto": "https",
        },
      },
    );

    let caught: unknown;
    try {
      assertAllowedOrigin(request);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpError);
    expect(caught).toMatchObject({
      status: 403,
      code: "origin_not_allowed",
    });
  });
});
