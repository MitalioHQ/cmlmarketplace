import "server-only";

import { randomUUID } from "node:crypto";

import type {
  CommerceOrder,
  OrderPreview,
  OrderPreviewRequest,
} from "@cml-marketplace/core";
import type { CmlOrderInput } from "@cml-marketplace/server";

import { readEnvironment } from "./environment";
import { HttpError } from "./errors";

export interface StoredPreview {
  id: string;
  customerId: number;
  request: OrderPreviewRequest;
  cmlOrder: CmlOrderInput;
  preview: OrderPreview;
  expiresAt: string;
}

export type CustomerClaim =
  | { kind: "existing"; customerId: number }
  | { kind: "claimed"; token: string }
  | { kind: "busy" };

export type PreviewClaim =
  | { kind: "claimed"; token: string; preview: StoredPreview }
  | { kind: "completed"; order: CommerceOrder }
  | { kind: "busy" }
  | { kind: "expired" }
  | { kind: "not_found" };

export interface CommerceStore {
  claimCustomer(channel: string, email: string): Promise<CustomerClaim>;
  completeCustomerClaim(
    channel: string,
    email: string,
    token: string,
    customerId: number,
  ): Promise<void>;
  releaseCustomerClaim(
    channel: string,
    email: string,
    token: string,
  ): Promise<void>;
  savePreview(preview: StoredPreview): Promise<void>;
  claimPreview(previewId: string): Promise<PreviewClaim>;
  releasePreviewClaim(previewId: string, token: string): Promise<void>;
  completePreview(
    previewId: string,
    token: string,
    order: CommerceOrder,
  ): Promise<void>;
  getOrder(orderId: string): Promise<CommerceOrder | undefined>;
  updateOrder(order: CommerceOrder): Promise<void>;
  consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean>;
}

interface MemoryCustomer {
  status: "creating" | "ready";
  customerId?: number;
  token?: string;
  claimExpiresAt?: number;
}

interface MemoryPreview {
  status: "active" | "confirming" | "consumed";
  value: StoredPreview;
  token?: string;
}

export class MemoryCommerceStore implements CommerceStore {
  private readonly customers = new Map<string, MemoryCustomer>();
  private readonly previews = new Map<string, MemoryPreview>();
  private readonly orders = new Map<string, CommerceOrder>();
  private readonly orderByPreview = new Map<string, string>();
  private readonly rateLimits = new Map<
    string,
    { count: number; startedAt: number }
  >();

  async claimCustomer(
    channel: string,
    email: string,
  ): Promise<CustomerClaim> {
    const key = `${channel}:${email}`;
    const existing = this.customers.get(key);
    const now = Date.now();

    if (existing?.status === "ready" && existing.customerId) {
      return { kind: "existing", customerId: existing.customerId };
    }

    if (
      existing?.status === "creating" &&
      (existing.claimExpiresAt ?? 0) > now
    ) {
      return { kind: "busy" };
    }

    const token = randomUUID();
    this.customers.set(key, {
      status: "creating",
      token,
      claimExpiresAt: now + 60_000,
    });
    return { kind: "claimed", token };
  }

  async completeCustomerClaim(
    channel: string,
    email: string,
    token: string,
    customerId: number,
  ): Promise<void> {
    const key = `${channel}:${email}`;
    const existing = this.customers.get(key);

    if (existing?.status !== "creating" || existing.token !== token) {
      throw new HttpError(
        409,
        "customer_claim_lost",
        "The customer creation claim is no longer active.",
      );
    }

    this.customers.set(key, { status: "ready", customerId });
  }

  async releaseCustomerClaim(
    channel: string,
    email: string,
    token: string,
  ): Promise<void> {
    const key = `${channel}:${email}`;
    if (this.customers.get(key)?.token === token) {
      this.customers.delete(key);
    }
  }

  async savePreview(preview: StoredPreview): Promise<void> {
    this.previews.set(preview.id, { status: "active", value: preview });
  }

  async claimPreview(previewId: string): Promise<PreviewClaim> {
    const completedOrderId = this.orderByPreview.get(previewId);
    const completedOrder = completedOrderId
      ? this.orders.get(completedOrderId)
      : undefined;

    if (completedOrder) {
      return { kind: "completed", order: completedOrder };
    }

    const stored = this.previews.get(previewId);
    if (!stored) {
      return { kind: "not_found" };
    }

    if (new Date(stored.value.expiresAt).getTime() <= Date.now()) {
      return { kind: "expired" };
    }

    if (stored.status === "confirming") {
      return { kind: "busy" };
    }

    const token = randomUUID();
    stored.status = "confirming";
    stored.token = token;
    return { kind: "claimed", token, preview: stored.value };
  }

  async releasePreviewClaim(
    previewId: string,
    token: string,
  ): Promise<void> {
    const stored = this.previews.get(previewId);
    if (stored?.status === "confirming" && stored.token === token) {
      stored.status = "active";
      stored.token = undefined;
    }
  }

  async completePreview(
    previewId: string,
    token: string,
    order: CommerceOrder,
  ): Promise<void> {
    const stored = this.previews.get(previewId);
    if (stored?.status !== "confirming" || stored.token !== token) {
      throw new HttpError(
        409,
        "preview_claim_lost",
        "The order preview claim is no longer active.",
      );
    }

    stored.status = "consumed";
    stored.token = undefined;
    this.orders.set(order.id, order);
    this.orderByPreview.set(previewId, order.id);
  }

  async getOrder(orderId: string): Promise<CommerceOrder | undefined> {
    return this.orders.get(orderId);
  }

  async updateOrder(order: CommerceOrder): Promise<void> {
    this.orders.set(order.id, order);
  }

  async consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const now = Date.now();
    const existing = this.rateLimits.get(key);

    if (!existing || existing.startedAt + windowSeconds * 1000 <= now) {
      this.rateLimits.set(key, { count: 1, startedAt: now });
      return true;
    }

    existing.count += 1;
    return existing.count <= limit;
  }
}

let store: CommerceStore | undefined;

export async function getCommerceStore(): Promise<CommerceStore> {
  if (store) {
    return store;
  }

  const environment = readEnvironment();
  if (environment.databaseUrl) {
    const { PostgresCommerceStore } = await import("./store-postgres");
    store = new PostgresCommerceStore(environment.databaseUrl);
    return store;
  }

  if (!environment.production) {
    store = new MemoryCommerceStore();
    return store;
  }

  throw new HttpError(
    503,
    "storage_not_configured",
    "Durable checkout storage is not configured.",
  );
}

export function setCommerceStoreForTesting(
  nextStore: CommerceStore | undefined,
): void {
  store = nextStore;
}
