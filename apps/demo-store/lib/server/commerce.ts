import "server-only";

import { randomUUID } from "node:crypto";

import type {
  Catalog,
  CommerceOrder,
  OrderPreview,
  OrderPreviewRequest,
} from "@cml-marketplace/core";
import {
  createCmlApiClient,
  type CmlApiClient,
} from "@cml-marketplace/server";

import {
  asPositiveInteger,
  asString,
  extractCmlOrder,
  formatCmlAmount,
} from "./cml-response";
import {
  isCheckoutConfigured,
  isCmlConfigured,
  readEnvironment,
} from "./environment";
import { HttpError } from "./errors";
import {
  extractCreatedCustomerId,
  mapCatalog,
  mapOrder,
  mapPreview,
  normalizeCountry,
  toCmlCustomer,
  toCmlOrder,
} from "./mappers";
import { getCommerceStore } from "./store";

let cmlClientOverride: CmlApiClient | undefined;
let cachedCmlClient: CmlApiClient | undefined;

export function getDemoConfig() {
  const environment = readEnvironment();

  return {
    cmlConfigured: isCmlConfigured(environment),
    checkoutConfigured: isCheckoutConfigured(environment),
    mutationsEnabled: environment.mutationsEnabled,
    channelSlug: environment.channelSlug,
    defaultCountry: environment.defaultCountry,
    catalogMode: isCmlConfigured(environment)
      ? ("live" as const)
      : ("unconfigured" as const),
    paymentMode: "simulation_with_live_cml_mutations" as const,
  };
}

export async function getCatalog(country: string): Promise<Catalog> {
  const environment = readEnvironment();
  const countryCode = normalizeCountry(
    country || environment.defaultCountry,
  );
  const raw = await requireCmlClient().getCatalog({
    channel: environment.channelSlug,
    country_code: countryCode,
  });
  return mapCatalog(raw, countryCode, environment.channelSlug);
}

export async function createPreview(
  request: OrderPreviewRequest,
): Promise<OrderPreview> {
  const environment = readEnvironment();
  const cml = requireCmlClient();
  const store = await getCommerceStore();
  const country = normalizeCountry(
    request.customer.countryCode || environment.defaultCountry,
  );
  const rawCatalog = await cml.getCatalog({
    channel: environment.channelSlug,
    country_code: country,
  });
  const catalog = mapCatalog(
    rawCatalog,
    country,
    environment.channelSlug,
  );

  if (!catalog.available) {
    throw new HttpError(
      409,
      "catalog_unavailable",
      "The CML catalogue is unavailable for this customer.",
    );
  }

  const validatedOrder = toCmlOrder(
    request,
    1,
    environment.channelSlug,
    catalog,
  );
  const customerId = await findOrCreateCustomer(request, cml);
  const cmlOrder = { ...validatedOrder, customer_id: customerId };
  const rawPreview = await cml.previewOrder(cmlOrder);
  const mapped = mapPreview(rawPreview, request, catalog);
  const id = `preview_${randomUUID()}`;
  const preview = { ...mapped, id };

  await store.savePreview({
    id,
    customerId,
    request,
    cmlOrder,
    preview,
    expiresAt: preview.expiresAt,
  });

  return preview;
}

export async function confirmPreview(
  previewId: string,
): Promise<CommerceOrder> {
  const store = await getCommerceStore();
  const claim = await store.claimPreview(previewId);

  if (claim.kind === "completed") {
    return claim.order;
  }
  if (claim.kind === "not_found") {
    throw new HttpError(
      404,
      "preview_not_found",
      "This order preview does not exist.",
    );
  }
  if (claim.kind === "expired") {
    throw new HttpError(
      410,
      "preview_expired",
      "This order preview has expired. Create a new preview.",
    );
  }
  if (claim.kind === "busy") {
    throw new HttpError(
      409,
      "preview_confirmation_in_progress",
      "This order preview is already being confirmed.",
    );
  }

  const cml = requireCmlClient();

  try {
    const submitted = await cml.submitOrder(claim.preview.cmlOrder);
    const submittedOrder = extractCmlOrder(submitted);
    const orderId = asPositiveInteger(submittedOrder.id);

    if (!orderId) {
      throw new HttpError(
        502,
        "invalid_cml_response",
        "CML created the draft but did not return its numeric order ID.",
      );
    }

    await cml.confirmOrder(orderId);
    let authoritative = submittedOrder;
    const orderCode = asString(submittedOrder.code);

    if (orderCode) {
      authoritative = extractCmlOrder(await cml.getOrder(orderCode));
    }

    const order = mapOrder(
      authoritative,
      claim.preview.preview,
      claim.preview.customerId,
      orderId,
      orderCode,
    );
    await store.completePreview(previewId, claim.token, order);
    return order;
  } catch (error) {
    await store.releasePreviewClaim(previewId, claim.token);
    throw error;
  }
}

export async function simulatePayment(
  orderId: string,
): Promise<{
  simulated: true;
  recordedInCml: true;
  liveOrderStatus: CommerceOrder["status"];
  order: CommerceOrder;
}> {
  const store = await getCommerceStore();
  const order = await store.getOrder(orderId);

  if (!order) {
    throw new HttpError(
      404,
      "order_not_found",
      "The live CML order is not available in checkout storage.",
    );
  }

  if (order.status === "paid") {
    return {
      simulated: true,
      recordedInCml: true,
      liveOrderStatus: order.status,
      order,
    };
  }

  if (
    order.status !== "pending_payment" &&
    order.status !== "partially_paid"
  ) {
    throw new HttpError(
      409,
      "order_not_payable",
      `CML order ${order.code} is ${order.status} and cannot receive a captured payment.`,
    );
  }

  const cml = requireCmlClient();
  const providerTransactionId = `cml-demo-${order.code}`;

  try {
    await cml.recordPayment({
      order_code: order.code,
      provider: "cml-marketplace-demo",
      provider_txn_id: providerTransactionId,
      amount: formatCmlAmount(order.amountDue),
      status: 1,
      payment_method: "demo_button",
    });
  } catch (error) {
    if (getStatus(error) !== 409) {
      throw error;
    }
  }

  const authoritative = extractCmlOrder(await cml.getOrder(order.code));
  const paidOrder = mapOrder(
    authoritative,
    order,
    Number(order.customerId),
    Number(order.id),
    order.code,
  );
  await store.updateOrder(paidOrder);

  return {
    simulated: true,
    recordedInCml: true,
    liveOrderStatus: paidOrder.status,
    order: paidOrder,
  };
}

export async function simulatePaymentFailure(
  orderId: string,
): Promise<{
  simulated: true;
  failedPaymentRecordedInCml: true;
  cancelledInCml: true;
  liveOrderStatus: CommerceOrder["status"];
  order: CommerceOrder;
}> {
  const store = await getCommerceStore();
  const order = await store.getOrder(orderId);

  if (!order) {
    throw new HttpError(
      404,
      "order_not_found",
      "The live CML order is not available in checkout storage.",
    );
  }

  if (order.status === "cancelled") {
    return {
      simulated: true,
      failedPaymentRecordedInCml: true,
      cancelledInCml: true,
      liveOrderStatus: order.status,
      order,
    };
  }

  if (order.status !== "pending_payment") {
    throw new HttpError(
      409,
      "order_not_cancellable_after_payment_failure",
      `CML order ${order.code} is ${order.status}. This demo only cancels unpaid Pending Payment orders.`,
    );
  }

  const cml = requireCmlClient();
  const providerTransactionId = `cml-demo-failed-${order.code}`;

  try {
    await cml.recordPayment({
      order_code: order.code,
      provider: "cml-marketplace-demo",
      provider_txn_id: providerTransactionId,
      amount: formatCmlAmount(order.amountDue),
      status: 2,
      payment_method: "demo_button",
    });
  } catch (error) {
    if (getStatus(error) !== 409) {
      throw error;
    }
  }

  await cml.cancelOrder({
    order_id: Number(order.id),
    notes: "Demo provider payment failed before capture.",
  });

  const authoritative = extractCmlOrder(await cml.getOrder(order.code));
  const cancelledOrder = mapOrder(
    authoritative,
    order,
    Number(order.customerId),
    Number(order.id),
    order.code,
  );

  if (cancelledOrder.status !== "cancelled") {
    throw new HttpError(
      502,
      "cml_cancellation_not_confirmed",
      "CML accepted the cancellation request but did not return a Cancelled order.",
    );
  }

  await store.updateOrder(cancelledOrder);

  return {
    simulated: true,
    failedPaymentRecordedInCml: true,
    cancelledInCml: true,
    liveOrderStatus: cancelledOrder.status,
    order: cancelledOrder,
  };
}

async function findOrCreateCustomer(
  request: OrderPreviewRequest,
  cml: CmlApiClient,
): Promise<number> {
  const environment = readEnvironment();
  const store = await getCommerceStore();
  const email = request.customer.email.trim().toLowerCase();
  const claim = await store.claimCustomer(environment.channelSlug, email);

  if (claim.kind === "existing") {
    return claim.customerId;
  }

  if (claim.kind === "busy") {
    throw new HttpError(
      409,
      "customer_creation_in_progress",
      "This customer is already being created. Retry shortly.",
    );
  }

  try {
    const response = await cml.createCustomer(
      toCmlCustomer(request.customer),
    );
    const customerId = extractCreatedCustomerId(response);
    await store.completeCustomerClaim(
      environment.channelSlug,
      email,
      claim.token,
      customerId,
    );
    return customerId;
  } catch (error) {
    await store.releaseCustomerClaim(
      environment.channelSlug,
      email,
      claim.token,
    );

    if (getStatus(error) === 409) {
      throw new HttpError(
        409,
        "customer_exists",
        "This email already belongs to a CML customer, but its CML ID is not linked in this deployment.",
      );
    }

    throw error;
  }
}

function requireCmlClient(): CmlApiClient {
  if (cmlClientOverride) {
    return cmlClientOverride;
  }

  if (cachedCmlClient) {
    return cachedCmlClient;
  }

  const environment = readEnvironment();
  if (!isCmlConfigured(environment)) {
    throw new HttpError(
      503,
      "cml_not_configured",
      "CML API credentials are not configured.",
    );
  }

  cachedCmlClient = createCmlApiClient({
    apiKey: environment.apiKey,
    apiSecret: environment.apiSecret,
    ...(environment.apiBaseUrl
      ? { baseUrl: environment.apiBaseUrl }
      : {}),
  });
  return cachedCmlClient;
}

function getStatus(error: unknown): number | undefined {
  return error && typeof error === "object" && "status" in error
    ? Number(error.status)
    : undefined;
}

export function setCmlClientForTesting(
  client: CmlApiClient | undefined,
): void {
  cmlClientOverride = client;
  cachedCmlClient = undefined;
}
