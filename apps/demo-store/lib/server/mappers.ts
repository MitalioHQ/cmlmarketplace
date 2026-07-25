import "server-only";

import type {
  Catalog,
  CommerceOrder,
  CustomerInput,
  OrderPreview,
  OrderPreviewRequest,
  OrderStatus,
} from "@cml-marketplace/core";
import type {
  CmlCustomerInput,
  CmlOrderInput,
} from "@cml-marketplace/server";

import {
  asPositiveInteger,
  asRecord,
  asString,
  extractCmlOrder,
  extractCmlWarnings,
  parseCmlMoney,
  type UnknownRecord,
} from "./cml-response";
import { HttpError } from "./errors";

export function toCmlCustomer(customer: CustomerInput): CmlCustomerInput {
  return {
    email: customer.email.trim().toLowerCase(),
    first_name: customer.firstName.trim(),
    last_name: customer.lastName.trim(),
    type: customer.company?.trim() ? "Business" : "Individual",
    ...(customer.postalCode?.trim()
      ? { postal_code: customer.postalCode.trim() }
      : {}),
    ...(customer.countryCode?.trim()
      ? { country_code: normalizeCountry(customer.countryCode) }
      : {}),
    ...(customer.state?.trim() ? { state: customer.state.trim() } : {}),
    ...(customer.addressLine1?.trim()
      ? {
          address: [
            customer.addressLine1.trim(),
            customer.addressLine2?.trim(),
            customer.city?.trim(),
          ]
            .filter(Boolean)
            .join(", "),
        }
      : {}),
    ...(customer.phone?.trim() ? { phone: customer.phone.trim() } : {}),
    ...(customer.taxId?.trim() ? { tax_id: customer.taxId.trim() } : {}),
    referee: false,
  };
}

export function toCmlOrder(
  request: OrderPreviewRequest,
  customerId: number,
  configuredChannel: string,
  catalog: Catalog,
): CmlOrderInput {
  if (request.channelSlug !== configuredChannel) {
    throw new HttpError(
      400,
      "invalid_channel",
      "The checkout channel does not match the configured sales channel.",
    );
  }

  const products = new Map(
    catalog.products.map((product) => [product.id, product]),
  );

  return {
    customer_id: customerId,
    sales_channel: configuredChannel,
    ...(request.referralCode?.trim()
      ? { referral_code: request.referralCode.trim() }
      : {}),
    items: request.items.map((item) => {
      const product = products.get(String(item.productId));
      const productId = asPositiveInteger(item.productId);

      if (!product || !product.purchasable || !productId) {
        throw new HttpError(
          400,
          "invalid_product",
          "A selected item is not purchasable in the current CML catalogue.",
        );
      }

      const targetId = item.targetId?.trim();
      const targetHost = item.targetHost?.trim();
      return {
        product_id: productId,
        qty: item.quantity,
        ...(targetId || targetHost
          ? {
              metadata: {
                specific_rules: {
                  type: "account",
                  ...(targetId ? { target_id: targetId } : {}),
                  ...(targetHost ? { target_host: targetHost } : {}),
                },
              },
            }
          : {}),
      };
    }),
  };
}

export function mapCatalog(
  raw: unknown,
  countryCode: string,
  channelSlug: string,
): Catalog {
  const success = asRecord(asRecord(raw).success);
  const channel = asRecord(success.channel);
  const entries = Array.isArray(success.products) ? success.products : [];

  return {
    channel: {
      id: `channel_${asString(channel.slug) || channelSlug}`,
      slug: asString(channel.slug) || channelSlug,
      displayName:
        asString(channel.display_name) ||
        `${capitalize(channelSlug)} Marketplace`,
      websiteUrl: "#catalog",
      termsUrl: "#support",
      privacyUrl: "#support",
      supportUrl: "#support",
    },
    countryCode: asString(success.country_code) || countryCode,
    available: success.available !== false,
    ...(!success.available
      ? {
          fallback: {
            title: asString(success.title) || "Catalogue unavailable",
            message:
              asString(success.message) ||
              "This catalogue is not available in the selected country.",
          },
        }
      : {}),
    products: entries.map((value, index) => {
      const entry = asRecord(value);
      const product = asRecord(entry.product);
      const program = asRecord(entry.program);
      const numericProductId = asPositiveInteger(
        entry.product_id ?? product.id ?? entry.id,
      );
      const code =
        asString(product.code) ||
        asString(entry.product_code) ||
        `PRODUCT-${index + 1}`;
      const programName =
        asString(program.name) || asString(program.code) || "Software";

      return {
        id: numericProductId ? String(numericProductId) : code,
        code,
        title: asString(product.title) || code,
        description:
          asString(product.description) ||
          asString(program.description) ||
          "Software licence available through CheckMyLicense.",
        price: parseCmlMoney(
          entry.price,
          asString(entry.currency) || "USD",
        ),
        position: Number.isFinite(Number(entry.position))
          ? Number(entry.position)
          : index,
        purchasable: Boolean(numericProductId),
        category: programName,
        ...(entry.is_default === true ? { badge: "Default" } : {}),
        metadata: {
          cmlProductId: numericProductId,
          cmlProgramId: asPositiveInteger(entry.program_id),
          cmlProgramCode: asString(program.code),
          logo: asString(program.logo),
          validityDays: Number(entry.validity_days) || undefined,
          activationLimit: Number(entry.activation_limit) || undefined,
          activationsDeletable: entry.activations_deletable === true,
          accent: ["violet", "blue", "green", "orange"][index % 4],
          mark: (asString(program.code) || code).slice(0, 1).toUpperCase(),
        },
      };
    }),
    fetchedAt: new Date().toISOString(),
  };
}

export function mapPreview(
  raw: unknown,
  request: OrderPreviewRequest,
  catalog: Catalog,
): OrderPreview {
  const source = extractCmlOrder(raw);
  const items = request.items.map((item) => {
    const product = catalog.products.find(
      (candidate) => candidate.id === String(item.productId),
    );
    const unitPrice = product?.price ?? parseCmlMoney(0, "USD");

    return {
      productId: String(item.productId),
      code: product?.code ?? String(item.productId),
      title: product?.title ?? "CML product",
      quantity: item.quantity,
      unitPrice,
      lineTotal: {
        amountMinor: unitPrice.amountMinor * item.quantity,
        currency: unitPrice.currency,
      },
      ...(item.targetId ? { targetId: item.targetId } : {}),
      ...(item.targetHost ? { targetHost: item.targetHost } : {}),
    };
  });
  const currency =
    asString(source.currency) || items[0]?.unitPrice.currency || "USD";
  const subtotalFallback = items.reduce(
    (sum, item) => sum + item.lineTotal.amountMinor,
    0,
  );
  const subtotal = parseCmlMoney(
    source.original_amount ?? source.subtotal,
    currency,
    subtotalFallback,
  );
  const discount = parseCmlMoney(source.discount_amount, currency, 0);
  const total = parseCmlMoney(
    source.final_amount ?? source.total,
    currency,
    Math.max(0, subtotal.amountMinor - discount.amountMinor),
  );

  return {
    id: "",
    channel: catalog.channel,
    customer: { ...request.customer },
    items,
    totals: { subtotal, discount, total },
    warnings: extractCmlWarnings(raw),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

interface OrderSnapshot {
  channel: OrderPreview["channel"];
  items: OrderPreview["items"];
  totals: OrderPreview["totals"];
}

export function mapOrder(
  source: UnknownRecord,
  snapshot: OrderSnapshot,
  customerId: number,
  numericId: number,
  fallbackCode?: string,
): CommerceOrder {
  const code = asString(source.code) || fallbackCode || `CML-${numericId}`;
  const status = mapOrderStatus(source.status ?? 1);
  const currency =
    asString(source.currency) || snapshot.totals.total.currency;
  const totals = {
    subtotal: parseCmlMoney(
      source.original_amount,
      currency,
      snapshot.totals.subtotal.amountMinor,
    ),
    discount: parseCmlMoney(
      source.discount_amount,
      currency,
      snapshot.totals.discount.amountMinor,
    ),
    total: parseCmlMoney(
      source.final_amount,
      currency,
      snapshot.totals.total.amountMinor,
    ),
  };

  return {
    id: String(numericId),
    code,
    status,
    fulfillmentStatus: status === "paid" ? "pending" : "not_started",
    customerId: String(customerId),
    channel: snapshot.channel,
    items: snapshot.items,
    totals,
    amountPaid:
      status === "paid"
        ? totals.total
        : { amountMinor: 0, currency: totals.total.currency },
    amountDue:
      status === "paid"
        ? { amountMinor: 0, currency: totals.total.currency }
        : totals.total,
    createdAt: asString(source.created_at) || new Date().toISOString(),
    confirmedAt: asString(source.updated_at) || new Date().toISOString(),
  };
}

export function extractCreatedCustomerId(response: unknown): number {
  const root = asRecord(response);
  const customerRecord = asRecord(
    asRecord(root.data).customer ?? asRecord(root.success).customer,
  );
  const customerId = asPositiveInteger(customerRecord.id);

  if (!customerId) {
    throw new HttpError(
      502,
      "invalid_cml_response",
      "CML created the customer but did not return a numeric customer ID.",
    );
  }

  return customerId;
}

export function normalizeCountry(value: string): string {
  const normalized = value.trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new HttpError(
      400,
      "invalid_country",
      "Country must be an ISO alpha-2 code.",
    );
  }

  return normalized;
}

function mapOrderStatus(value: unknown): OrderStatus {
  const status = Number(value);
  return (
    {
      0: "draft",
      1: "pending_payment",
      2: "partially_paid",
      3: "paid",
      4: "cancelled",
      5: "refunded",
      6: "partially_refunded",
    } satisfies Record<number, OrderStatus>
  )[status] ?? "pending_payment";
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
