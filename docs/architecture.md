# CML Marketplace architecture

## Product boundary

CML Marketplace is a headless commerce layer, not a hosted checkout.

| Capability | Owner |
| --- | --- |
| Catalogue, availability, price, customer, and order record | CML |
| Sales-channel and country policy | CML |
| Cart UI and temporary cart state | Merchant |
| Provider checkout and webhook validation | Merchant |
| Payment ledger and paid transition | CML |
| Licence fulfilment | CML jobs |

## Trust boundaries

The browser calls the merchant's `/api/*` routes. It never receives the CML API
secret. The merchant server signs every upstream request with:

1. `SHA256(exactRawJsonBody)` as lowercase hexadecimal.
2. Canonical text: `<api-key>.<unix-seconds>.<body-hash>`.
3. Base64 `HMAC-SHA256(api-secret, canonical-text)`.

The API key, timestamp, and signature are sent through `X-API-Key`,
`X-API-Timestamp`, and `X-API-Signature`. The secret is not transmitted.

Mutation routes require a browser `Origin` in production. The origin must match
the public request origin or an explicitly configured
`CML_ALLOWED_ORIGINS` entry. Because Vercel Functions can expose an internal
request URL, the public same-origin value is reconstructed from
`host`/`x-forwarded-host` and `x-forwarded-proto`. Origins are normalized before
comparison; wildcards are not supported.

The merchant validates the payment provider webhook before calling
`/order/payment`. The globally unique `provider_txn_id` is the replay guard.

## Checkout lifecycle

1. The server reads `/sales-channel/catalog` for channel `northstar` and the
   customer's ISO alpha-2 country.
2. The browser builds a local cart using CML product IDs and quantities.
3. The server creates a CML customer through `/order/customer`.
4. The server calls `/order/submit` with `preview: true`; CML calculates the
   authoritative totals without creating an order.
5. After the customer confirms, the server calls `/order/submit` without
   preview. CML persists a Draft order.
6. The server calls `/order/confirm`; CML moves the order to Pending Payment.
7. The merchant creates any provider checkout and stores the CML order code in
   its own metadata.
8. After verifying the provider webhook, the merchant calls `/order/payment`.
9. On capture, when payments cover the total, CML marks the order Paid and
   queues licence fulfilment.
10. On a definitive failure, the merchant records payment status `2`. If its
    policy abandons the checkout, it then calls `/order/cancel` for the unpaid
    Pending Payment order.

## Customer identity limitation

The public CML endpoint creates customers and rejects duplicate emails. It does
not currently expose lookup-by-email or upsert. The Next.js demo persists
email-to-ID mappings in Postgres and serializes creation attempts per normalized
email. A duplicate CML customer that predates the integration record is
surfaced as a clear conflict.

## Runtime boundary

The storefront uses the Next.js App Router. Interactive cart and checkout UI
remain in a Client Component. Each `/api/*` endpoint is a Node.js Route Handler
that can run as an independent Vercel Function.

No correctness-critical state is stored in process memory in production:

- customer-to-CML links are durable;
- preview payloads have a 15-minute expiry and an atomic confirmation claim;
- confirmed orders remain available to later payment requests;
- rate-limit counters are shared by all function instances.

Local development falls back to an in-memory store only when `DATABASE_URL` is
absent and `NODE_ENV` is not `production`.

## Demo safety

Catalogue reads are safe to exercise during QA. Customer creation and order
creation happen only after a user submits the checkout form. The success
button simulates the external provider but records a live captured CML payment;
it can mark the order Paid and trigger real licence jobs. The failure button
records a live failed-payment entry and cancels the live unpaid order. It is
restricted to Pending Payment orders and never requests a refund or licence
deactivation.

All mutation Route Handlers are disabled unless
`CML_DEMO_MUTATIONS_ENABLED=true`. They also validate the request origin,
enforce request-size and schema limits, and use shared rate limits. Production
deployments require durable storage.
