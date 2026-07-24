import { describe, expect, it } from "vitest";

import {
  extractCmlOrder,
  extractCmlWarnings,
  formatCmlAmount,
  parseCmlMoney,
} from "./cml-response.mjs";

describe("CML response mapping", () => {
  it("parses formatted catalogue prices into exact minor units", () => {
    expect(parseCmlMoney("$249.00", "USD")).toEqual({
      amountMinor: 24_900,
      currency: "USD",
    });
    expect(parseCmlMoney("EUR 1,299.95", "EUR")).toEqual({
      amountMinor: 129_995,
      currency: "EUR",
    });
  });

  it("extracts the order from the deployed nested success envelope", () => {
    expect(
      extractCmlOrder({
        success: {
          success: true,
          warnings: [],
          data: {
            order: {
              id: 114,
              code: "ORD2607241339208DH",
              status: 0,
            },
          },
        },
      }),
    ).toEqual({
      id: 114,
      code: "ORD2607241339208DH",
      status: 0,
    });
  });

  it("extracts warnings from both supported envelopes", () => {
    expect(
      extractCmlWarnings({
        success: { warnings: ["Referral code not found"] },
      }),
    ).toEqual(["Referral code not found"]);
    expect(extractCmlWarnings({ warnings: ["Legacy warning"] })).toEqual([
      "Legacy warning",
    ]);
  });

  it("formats exact minor units for the CML payment API", () => {
    expect(formatCmlAmount({ amountMinor: 24_900, currency: "USD" })).toBe(
      "249.00",
    );
    expect(formatCmlAmount({ amountMinor: 39, currency: "USD" })).toBe(
      "0.39",
    );
  });
});
