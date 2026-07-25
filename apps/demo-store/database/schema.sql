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
