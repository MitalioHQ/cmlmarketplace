import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createCmlApiClient } from "@cml-marketplace/server";
import { createServer as createViteServer } from "vite";

import {
  extractCmlOrder as extractOrder,
  extractCmlWarnings,
  formatCmlAmount,
  parseCmlMoney as toMoney,
} from "./cml-response.mjs";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = resolve(appRoot, "../..");
loadLocalEnvironment(resolve(workspaceRoot, ".env.local"));

const port = Number(process.env.PORT ?? 4173);
const channelSlug = process.env.CML_CHANNEL_SLUG?.trim() || "northstar";
const defaultCountry =
  process.env.CML_DEFAULT_COUNTRY?.trim().toUpperCase() || "LB";
const apiKey = process.env.CML_API_KEY?.trim() || "";
const apiSecret = process.env.CML_API_SECRET?.trim() || "";
const cmlConfigured = Boolean(apiKey && apiSecret);
const cml = cmlConfigured
  ? createCmlApiClient({
      apiKey,
      apiSecret,
      ...(process.env.CML_API_BASE_URL
        ? { baseUrl: process.env.CML_API_BASE_URL }
        : {}),
    })
  : undefined;

const checkoutSessions = new Map();
const customersByEmail = new Map();
const ordersById = new Map();
let latestCatalog;

const vite = await createViteServer({
  root: appRoot,
  appType: "spa",
  server: { middlewareMode: true },
});

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApiRequest(request, response, url);
    return;
  }

  vite.middlewares(request, response, (error) => {
    if (error) {
      vite.ssrFixStacktrace(error);
      sendError(response, error);
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `CML Marketplace demo listening on http://127.0.0.1:${port}/ (${cmlConfigured ? "live CML gateway" : "CML credentials required"})`,
  );
});

async function handleApiRequest(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/config") {
      sendJson(response, 200, {
        cmlConfigured,
        channelSlug,
        defaultCountry,
        catalogMode: cmlConfigured ? "live" : "unconfigured",
        paymentMode: "simulation_with_live_cml_record",
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/catalog") {
      requireCml();
      const countryCode = normalizeCountry(
        url.searchParams.get("country") || defaultCountry,
      );
      const rawCatalog = await cml.getCatalog({
        channel: channelSlug,
        country_code: countryCode,
      });
      latestCatalog = mapCatalog(rawCatalog, countryCode);
      sendJson(response, 200, latestCatalog);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/checkout/preview"
    ) {
      requireCml();
      const body = await readJson(request);
      validatePreviewRequest(body);
      const customerId = await findOrCreateCustomer(body.customer);
      const cmlOrder = toCmlOrder(body, customerId);
      const rawPreview = await cml.previewOrder(cmlOrder);
      const preview = mapPreview(rawPreview, body, latestCatalog);
      const previewId = `preview_${randomUUID()}`;
      const storedPreview = { ...preview, id: previewId };

      checkoutSessions.set(previewId, {
        customerId,
        request: body,
        cmlOrder,
        preview: storedPreview,
      });
      sendJson(response, 200, storedPreview);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/checkout/confirm"
    ) {
      requireCml();
      const body = await readJson(request);
      const previewId =
        typeof body.previewId === "string" ? body.previewId : "";
      const session = checkoutSessions.get(previewId);

      if (!session) {
        throw httpError(
          404,
          "preview_not_found",
          "This order preview has expired. Create a new preview.",
        );
      }

      const submitted = await cml.submitOrder(session.cmlOrder);
      const submittedOrder = extractOrder(submitted);
      const orderId = asPositiveInteger(submittedOrder.id);

      if (!orderId) {
        throw httpError(
          502,
          "invalid_cml_response",
          "CML created the draft but did not return its numeric order ID.",
        );
      }

      await cml.confirmOrder(orderId);
      let authoritative = submittedOrder;
      const orderCode = asString(submittedOrder.code);

      if (orderCode) {
        authoritative = extractOrder(await cml.getOrder(orderCode));
      }

      const order = mapOrder(
        authoritative,
        session.preview,
        session.customerId,
        orderId,
        orderCode,
      );
      ordersById.set(order.id, order);
      checkoutSessions.delete(previewId);
      sendJson(response, 200, order);
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/checkout/simulate-payment"
    ) {
      requireCml();
      const body = await readJson(request);
      const orderId = typeof body.orderId === "string" ? body.orderId : "";
      const order = ordersById.get(orderId);

      if (!order) {
        throw httpError(
          404,
          "order_not_found",
          "The live CML order is not available in this demo session.",
        );
      }

      if (order.status === "paid") {
        sendJson(response, 200, {
          simulated: true,
          recordedInCml: true,
          liveOrderStatus: order.status,
          order,
        });
        return;
      }

      if (
        order.status !== "pending_payment" &&
        order.status !== "partially_paid"
      ) {
        throw httpError(
          409,
          "order_not_payable",
          `CML order ${order.code} is ${order.status} and cannot receive a captured payment.`,
        );
      }

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
        if (
          !error ||
          typeof error !== "object" ||
          Number(error.status) !== 409
        ) {
          throw error;
        }
      }

      const authoritative = extractOrder(await cml.getOrder(order.code));
      const paidOrder = mapOrder(
        authoritative,
        order,
        Number(order.customerId),
        Number(order.id),
        order.code,
      );
      ordersById.set(order.id, paidOrder);

      sendJson(response, 200, {
        simulated: true,
        recordedInCml: true,
        liveOrderStatus: paidOrder.status,
        order: paidOrder,
      });
      return;
    }

    throw httpError(404, "route_not_found", "Demo API route not found.");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      Number(error.status) === 409 &&
      url.pathname === "/api/checkout/preview"
    ) {
      sendJson(response, 409, {
        error: {
          code: "customer_exists",
          message:
            "This email already belongs to a CML customer. The current public API can create customers but cannot look one up by email. Use a new test email or restart with an integration that already stores the CML customer ID.",
        },
      });
      return;
    }

    sendError(response, error);
  }
}

async function findOrCreateCustomer(customer) {
  const email = customer.email.trim();
  const cached = customersByEmail.get(email);

  if (cached) {
    return cached;
  }

  const response = await cml.createCustomer({
    email,
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
  });
  const customerRecord =
    asRecord(asRecord(response).data)?.customer ??
    asRecord(asRecord(response).success)?.customer;
  const customerId = asPositiveInteger(asRecord(customerRecord).id);

  if (!customerId) {
    throw httpError(
      502,
      "invalid_cml_response",
      "CML created the customer but did not return a numeric customer ID.",
    );
  }

  customersByEmail.set(email, customerId);
  return customerId;
}

function toCmlOrder(request, customerId) {
  return {
    customer_id: customerId,
    sales_channel: channelSlug,
    ...(request.referralCode?.trim()
      ? { referral_code: request.referralCode.trim() }
      : {}),
    items: request.items.map((item) => {
      const productId = asPositiveInteger(item.productId);

      if (!productId) {
        throw httpError(
          400,
          "invalid_product",
          "A selected catalogue item does not expose a numeric CML product ID.",
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

function mapCatalog(raw, countryCode) {
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
        price: toMoney(entry.price, asString(entry.currency) || "USD"),
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

function mapPreview(raw, request, catalog) {
  const source = extractOrder(raw);
  const items = request.items.map((item) => {
    const product = catalog?.products?.find(
      (candidate) => candidate.id === String(item.productId),
    );
    const unitPrice = product?.price ?? toMoney(0, "USD");

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
  const subtotal = toMoney(
    source.original_amount ?? source.subtotal,
    currency,
    subtotalFallback,
  );
  const discount = toMoney(source.discount_amount, currency, 0);
  const total = toMoney(
    source.final_amount ?? source.total,
    currency,
    Math.max(0, subtotal.amountMinor - discount.amountMinor),
  );
  return {
    id: "",
    channel: catalog?.channel ?? {
      id: `channel_${channelSlug}`,
      slug: channelSlug,
      displayName: `${capitalize(channelSlug)} Marketplace`,
    },
    customer: { ...request.customer },
    items,
    totals: { subtotal, discount, total },
    warnings: extractCmlWarnings(raw),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  };
}

function mapOrder(source, preview, customerId, numericId, fallbackCode) {
  const code = asString(source.code) || fallbackCode || `CML-${numericId}`;
  const status = mapOrderStatus(source.status ?? 1);
  const currency = asString(source.currency) || preview.totals.total.currency;
  const totals = {
    subtotal: toMoney(
      source.original_amount,
      currency,
      preview.totals.subtotal.amountMinor,
    ),
    discount: toMoney(
      source.discount_amount,
      currency,
      preview.totals.discount.amountMinor,
    ),
    total: toMoney(
      source.final_amount,
      currency,
      preview.totals.total.amountMinor,
    ),
  };

  return {
    id: String(numericId),
    code,
    status,
    fulfillmentStatus: status === "paid" ? "pending" : "not_started",
    customerId: String(customerId),
    channel: preview.channel,
    items: preview.items,
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

function mapOrderStatus(value) {
  const number = Number(value);
  return (
    {
      0: "draft",
      1: "pending_payment",
      2: "partially_paid",
      3: "paid",
      4: "cancelled",
      5: "refunded",
      6: "partially_refunded",
    }[number] || "pending_payment"
  );
}

function validatePreviewRequest(body) {
  if (!body || typeof body !== "object") {
    throw httpError(400, "invalid_request", "A JSON checkout body is required.");
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw httpError(400, "empty_cart", "Add at least one product.");
  }

  if (
    !body.customer ||
    typeof body.customer.email !== "string" ||
    !body.customer.email.includes("@") ||
    !body.customer.firstName?.trim() ||
    !body.customer.lastName?.trim()
  ) {
    throw httpError(
      400,
      "invalid_customer",
      "Email, first name, and last name are required.",
    );
  }
}

function requireCml() {
  if (!cml) {
    throw httpError(
      503,
      "cml_not_configured",
      "The server is running safely, but live CML credentials are not configured in .env.local.",
    );
  }
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw httpError(413, "request_too_large", "Request body is too large.");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function sendError(response, error) {
  const status =
    error && typeof error === "object" && Number(error.status)
      ? Number(error.status)
      : 500;
  const code =
    error && typeof error === "object" && error.code
      ? String(error.code)
      : "internal_error";
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";

  sendJson(response, status, { error: { code, message } });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function asPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function normalizeCountry(value) {
  const normalized = String(value).trim().toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw httpError(
      400,
      "invalid_country",
      "Country must be an ISO alpha-2 code.",
    );
  }

  return normalized;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function loadLocalEnvironment(path) {
  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator < 1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
