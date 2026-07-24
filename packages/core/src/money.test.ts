import { describe, expect, it } from "vitest";

import { addMoney, createMoney, formatMoney, multiplyMoney } from "./money.js";

describe("money", () => {
  it("performs exact minor-unit arithmetic", () => {
    const price = createMoney(1999, "usd");

    expect(multiplyMoney(price, 3)).toEqual({
      amountMinor: 5997,
      currency: "USD",
    });
    expect(addMoney(price, createMoney(1, "USD")).amountMinor).toBe(2000);
  });

  it("formats money for display", () => {
    expect(formatMoney(createMoney(4900, "USD"), "en-US")).toBe("$49.00");
  });

  it("rejects mixed-currency arithmetic", () => {
    expect(() =>
      addMoney(createMoney(1, "USD"), createMoney(1, "EUR")),
    ).toThrow("Cannot combine USD and EUR");
  });
});

