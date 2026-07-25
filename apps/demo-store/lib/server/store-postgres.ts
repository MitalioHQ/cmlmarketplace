import "server-only";

import { randomUUID } from "node:crypto";

import type { CommerceOrder } from "@cml-marketplace/core";
import postgres, { type Sql } from "postgres";

import { HttpError } from "./errors";
import type {
  CommerceStore,
  CustomerClaim,
  PreviewClaim,
  StoredPreview,
} from "./store";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cml_customer_links (
  channel_slug TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('creating', 'ready')),
  cml_customer_id BIGINT,
  claim_token UUID,
  claim_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_slug, email)
);

CREATE TABLE IF NOT EXISTS cml_checkout_previews (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('active', 'confirming', 'consumed', 'expired')),
  customer_id BIGINT NOT NULL,
  request_payload JSONB NOT NULL,
  cml_order_payload JSONB NOT NULL,
  preview_payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  claim_token UUID,
  order_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cml_checkout_previews_expires_idx
  ON cml_checkout_previews (expires_at);

CREATE TABLE IF NOT EXISTS cml_commerce_orders (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL UNIQUE REFERENCES cml_checkout_previews(id),
  order_code TEXT NOT NULL UNIQUE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cml_api_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  hits INTEGER NOT NULL
);
`;

interface CustomerRow {
  status: "creating" | "ready";
  cml_customer_id: string | number | null;
  claim_token: string | null;
}

interface PreviewRow {
  id: string;
  status: "active" | "confirming" | "consumed" | "expired";
  customer_id: string | number;
  request_payload: StoredPreview["request"];
  cml_order_payload: StoredPreview["cmlOrder"];
  preview_payload: StoredPreview["preview"];
  expires_at: Date | string;
  claim_token: string | null;
  order_id: string | null;
}

interface OrderRow {
  payload: CommerceOrder;
}

export class PostgresCommerceStore implements CommerceStore {
  private readonly sql: Sql;
  private readonly ready: Promise<void>;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    this.ready = this.initialize();
  }

  async claimCustomer(
    channel: string,
    email: string,
  ): Promise<CustomerClaim> {
    await this.ready;
    const token = randomUUID();
    const rows = await this.sql<CustomerRow[]>`
      INSERT INTO cml_customer_links (
        channel_slug,
        email,
        status,
        claim_token,
        claim_expires_at
      )
      VALUES (${channel}, ${email}, 'creating', ${token}, NOW() + INTERVAL '60 seconds')
      ON CONFLICT (channel_slug, email) DO UPDATE
      SET
        status = 'creating',
        cml_customer_id = NULL,
        claim_token = EXCLUDED.claim_token,
        claim_expires_at = EXCLUDED.claim_expires_at,
        updated_at = NOW()
      WHERE
        cml_customer_links.status = 'creating'
        AND cml_customer_links.claim_expires_at <= NOW()
      RETURNING status, cml_customer_id, claim_token
    `;
    const row = rows[0];

    if (row?.status === "ready" && row.cml_customer_id) {
      return {
        kind: "existing",
        customerId: Number(row.cml_customer_id),
      };
    }

    if (row?.claim_token === token) {
      return { kind: "claimed", token };
    }

    const existing = await this.sql<CustomerRow[]>`
      SELECT status, cml_customer_id, claim_token
      FROM cml_customer_links
      WHERE channel_slug = ${channel} AND email = ${email}
    `;
    const current = existing[0];

    if (current?.status === "ready" && current.cml_customer_id) {
      return {
        kind: "existing",
        customerId: Number(current.cml_customer_id),
      };
    }

    return { kind: "busy" };
  }

  async completeCustomerClaim(
    channel: string,
    email: string,
    token: string,
    customerId: number,
  ): Promise<void> {
    await this.ready;
    const result = await this.sql`
      UPDATE cml_customer_links
      SET
        status = 'ready',
        cml_customer_id = ${customerId},
        claim_token = NULL,
        claim_expires_at = NULL,
        updated_at = NOW()
      WHERE
        channel_slug = ${channel}
        AND email = ${email}
        AND status = 'creating'
        AND claim_token = ${token}
    `;

    if (result.count !== 1) {
      throw new HttpError(
        409,
        "customer_claim_lost",
        "The customer creation claim is no longer active.",
      );
    }
  }

  async releaseCustomerClaim(
    channel: string,
    email: string,
    token: string,
  ): Promise<void> {
    await this.ready;
    await this.sql`
      DELETE FROM cml_customer_links
      WHERE
        channel_slug = ${channel}
        AND email = ${email}
        AND status = 'creating'
        AND claim_token = ${token}
    `;
  }

  async savePreview(preview: StoredPreview): Promise<void> {
    await this.ready;
    await this.sql`
      INSERT INTO cml_checkout_previews (
        id,
        status,
        customer_id,
        request_payload,
        cml_order_payload,
        preview_payload,
        expires_at
      )
      VALUES (
        ${preview.id},
        'active',
        ${preview.customerId},
        ${this.sql.json(preview.request as never)},
        ${this.sql.json(preview.cmlOrder as never)},
        ${this.sql.json(preview.preview as never)},
        ${preview.expiresAt}
      )
    `;
  }

  async claimPreview(previewId: string): Promise<PreviewClaim> {
    await this.ready;
    const token = randomUUID();
    const claimed = await this.sql<PreviewRow[]>`
      UPDATE cml_checkout_previews
      SET status = 'confirming', claim_token = ${token}, updated_at = NOW()
      WHERE
        id = ${previewId}
        AND status = 'active'
        AND expires_at > NOW()
      RETURNING *
    `;
    const claimedRow = claimed[0];

    if (claimedRow) {
      return {
        kind: "claimed",
        token,
        preview: toStoredPreview(claimedRow),
      };
    }

    const rows = await this.sql<PreviewRow[]>`
      SELECT *
      FROM cml_checkout_previews
      WHERE id = ${previewId}
    `;
    const row = rows[0];

    if (!row) {
      return { kind: "not_found" };
    }

    if (row.status === "consumed" && row.order_id) {
      const order = await this.getOrder(row.order_id);
      return order
        ? { kind: "completed", order }
        : { kind: "not_found" };
    }

    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.sql`
        UPDATE cml_checkout_previews
        SET status = 'expired', updated_at = NOW()
        WHERE id = ${previewId} AND status = 'active'
      `;
      return { kind: "expired" };
    }

    return { kind: "busy" };
  }

  async releasePreviewClaim(
    previewId: string,
    token: string,
  ): Promise<void> {
    await this.ready;
    await this.sql`
      UPDATE cml_checkout_previews
      SET status = 'active', claim_token = NULL, updated_at = NOW()
      WHERE
        id = ${previewId}
        AND status = 'confirming'
        AND claim_token = ${token}
    `;
  }

  async completePreview(
    previewId: string,
    token: string,
    order: CommerceOrder,
  ): Promise<void> {
    await this.ready;
    await this.sql.begin(async (transaction) => {
      const preview = await transaction<PreviewRow[]>`
        UPDATE cml_checkout_previews
        SET
          status = 'consumed',
          claim_token = NULL,
          order_id = ${order.id},
          updated_at = NOW()
        WHERE
          id = ${previewId}
          AND status = 'confirming'
          AND claim_token = ${token}
        RETURNING *
      `;

      if (preview.length !== 1) {
        throw new HttpError(
          409,
          "preview_claim_lost",
          "The order preview claim is no longer active.",
        );
      }

      await transaction`
        INSERT INTO cml_commerce_orders (
          id,
          preview_id,
          order_code,
          payload
        )
        VALUES (
          ${order.id},
          ${previewId},
          ${order.code},
          ${transaction.json(order as never)}
        )
        ON CONFLICT (id) DO UPDATE
        SET payload = EXCLUDED.payload, updated_at = NOW()
      `;
    });
  }

  async getOrder(orderId: string): Promise<CommerceOrder | undefined> {
    await this.ready;
    const rows = await this.sql<OrderRow[]>`
      SELECT payload
      FROM cml_commerce_orders
      WHERE id = ${orderId}
    `;
    return rows[0]?.payload;
  }

  async updateOrder(order: CommerceOrder): Promise<void> {
    await this.ready;
    const result = await this.sql`
      UPDATE cml_commerce_orders
      SET payload = ${this.sql.json(order as never)}, updated_at = NOW()
      WHERE id = ${order.id}
    `;

    if (result.count !== 1) {
      throw new HttpError(
        404,
        "order_not_found",
        "The order is not available in durable checkout storage.",
      );
    }
  }

  async consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<boolean> {
    await this.ready;
    const rows = await this.sql<{ hits: number }[]>`
      INSERT INTO cml_api_rate_limits (
        bucket_key,
        window_started_at,
        hits
      )
      VALUES (${key}, NOW(), 1)
      ON CONFLICT (bucket_key) DO UPDATE
      SET
        window_started_at = CASE
          WHEN cml_api_rate_limits.window_started_at
            + (${windowSeconds} * INTERVAL '1 second') <= NOW()
          THEN NOW()
          ELSE cml_api_rate_limits.window_started_at
        END,
        hits = CASE
          WHEN cml_api_rate_limits.window_started_at
            + (${windowSeconds} * INTERVAL '1 second') <= NOW()
          THEN 1
          ELSE cml_api_rate_limits.hits + 1
        END
      RETURNING hits
    `;

    return Number(rows[0]?.hits ?? limit + 1) <= limit;
  }

  private async initialize(): Promise<void> {
    await this.sql.unsafe(SCHEMA);
  }
}

function toStoredPreview(row: PreviewRow): StoredPreview {
  return {
    id: row.id,
    customerId: Number(row.customer_id),
    request: row.request_payload,
    cmlOrder: row.cml_order_payload,
    preview: row.preview_payload,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}
