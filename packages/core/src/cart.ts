import { addMoney, multiplyMoney, zeroMoney } from "./money.js";
import type {
  Catalog,
  CatalogProduct,
  Money,
  OrderItemInput,
} from "./types.js";

export interface CartLine {
  productId: string;
  quantity: number;
  targetId?: string;
  targetHost?: string;
}

export interface Cart {
  version: 1;
  channelSlug: string;
  lines: readonly CartLine[];
}

export interface CartSummaryLine {
  line: CartLine;
  product: CatalogProduct;
  lineTotal: Money;
}

export interface CartSummary {
  lines: readonly CartSummaryLine[];
  itemCount: number;
  total: Money | undefined;
}

export function createCart(channelSlug: string): Cart {
  const normalizedSlug = channelSlug.trim();

  if (!normalizedSlug) {
    throw new TypeError("A channel slug is required to create a cart.");
  }

  return {
    version: 1,
    channelSlug: normalizedSlug,
    lines: [],
  };
}

export function addCartItem(
  cart: Cart,
  product: CatalogProduct,
  quantity = 1,
): Cart {
  assertQuantity(quantity);

  if (!product.purchasable) {
    throw new CartError(
      "product_unavailable",
      `${product.title} is not currently available.`,
    );
  }

  const existingLine = cart.lines.find(
    (line) => line.productId === product.id,
  );

  if (existingLine) {
    return setCartItemQuantity(
      cart,
      product.id,
      existingLine.quantity + quantity,
    );
  }

  return {
    ...cart,
    lines: [...cart.lines, { productId: product.id, quantity }],
  };
}

export function setCartItemQuantity(
  cart: Cart,
  productId: string,
  quantity: number,
): Cart {
  if (quantity === 0) {
    return removeCartItem(cart, productId);
  }

  assertQuantity(quantity);

  if (!cart.lines.some((line) => line.productId === productId)) {
    throw new CartError(
      "item_not_found",
      "The product is not present in this cart.",
    );
  }

  return {
    ...cart,
    lines: cart.lines.map((line) =>
      line.productId === productId ? { ...line, quantity } : line,
    ),
  };
}

export function setCartItemTarget(
  cart: Cart,
  productId: string,
  target: { targetId?: string; targetHost?: string },
): Cart {
  if (!cart.lines.some((line) => line.productId === productId)) {
    throw new CartError(
      "item_not_found",
      "The product is not present in this cart.",
    );
  }

  return {
    ...cart,
    lines: cart.lines.map((line) =>
      line.productId === productId
        ? {
            ...line,
            targetId: normalizeOptional(target.targetId),
            targetHost: normalizeOptional(target.targetHost),
          }
        : line,
    ),
  };
}

export function removeCartItem(cart: Cart, productId: string): Cart {
  return {
    ...cart,
    lines: cart.lines.filter((line) => line.productId !== productId),
  };
}

export function clearCart(cart: Cart): Cart {
  return {
    ...cart,
    lines: [],
  };
}

export function summarizeCart(cart: Cart, catalog: Catalog): CartSummary {
  if (cart.channelSlug !== catalog.channel.slug) {
    throw new CartError(
      "channel_mismatch",
      "The cart and catalogue belong to different sales channels.",
    );
  }

  const productsById = new Map(
    catalog.products.map((product) => [product.id, product]),
  );

  const lines = cart.lines.map((line): CartSummaryLine => {
    const product = productsById.get(line.productId);

    if (!product) {
      throw new CartError(
        "product_missing",
        `Product ${line.productId} is no longer in the catalogue.`,
      );
    }

    return {
      line,
      product,
      lineTotal: multiplyMoney(product.price, line.quantity),
    };
  });

  const firstLine = lines[0];
  const total = firstLine
    ? lines
        .slice(1)
        .reduce(
          (sum, line) => addMoney(sum, line.lineTotal),
          addMoney(
            zeroMoney(firstLine.lineTotal.currency),
            firstLine.lineTotal,
          ),
        )
    : undefined;

  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.line.quantity, 0),
    total,
  };
}

export function toOrderItems(cart: Cart): readonly OrderItemInput[] {
  return cart.lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    ...(line.targetId ? { targetId: line.targetId } : {}),
    ...(line.targetHost ? { targetHost: line.targetHost } : {}),
  }));
}

export class CartError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CartError";
    this.code = code;
  }
}

function assertQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new CartError(
      "invalid_quantity",
      "Cart quantity must be a positive whole number.",
    );
  }
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

