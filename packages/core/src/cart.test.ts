import { describe, expect, it } from "vitest";

import {
  addCartItem,
  createCart,
  removeCartItem,
  setCartItemQuantity,
  summarizeCart,
} from "./cart.js";
import type { Catalog, CatalogProduct } from "./types.js";

const product: CatalogProduct = {
  id: "product_1",
  code: "PRO",
  title: "Professional License",
  description: "A professional software license.",
  price: { amountMinor: 4900, currency: "USD" },
  position: 0,
  purchasable: true,
};

const catalog: Catalog = {
  channel: {
    id: "channel_1",
    slug: "demo",
    displayName: "Demo",
  },
  available: true,
  products: [product],
  fetchedAt: new Date(0).toISOString(),
};

describe("cart", () => {
  it("adds, updates, and totals an immutable cart", () => {
    const empty = createCart("demo");
    const withItem = addCartItem(empty, product, 2);
    const updated = setCartItemQuantity(withItem, product.id, 3);
    const summary = summarizeCart(updated, catalog);

    expect(empty.lines).toHaveLength(0);
    expect(withItem.lines[0]?.quantity).toBe(2);
    expect(summary.itemCount).toBe(3);
    expect(summary.total).toEqual({ amountMinor: 14700, currency: "USD" });
  });

  it("removes an item when quantity becomes zero", () => {
    const cart = addCartItem(createCart("demo"), product);
    const empty = setCartItemQuantity(cart, product.id, 0);

    expect(empty).toEqual(removeCartItem(cart, product.id));
    expect(empty.lines).toHaveLength(0);
  });

  it("rejects products outside the current catalogue", () => {
    const cart = addCartItem(createCart("demo"), product);
    const emptyCatalog = { ...catalog, products: [] };

    expect(() => summarizeCart(cart, emptyCatalog)).toThrow(
      "is no longer in the catalogue",
    );
  });
});

