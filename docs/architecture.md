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
9. When captured payments cover the total, CML marks the order Paid and queues
   licence fulfilment.

## Customer identity limitation

The public CML endpoint creates customers and rejects duplicate emails. It does
not currently expose lookup-by-email or upsert. The demo caches email-to-ID
mappings for its running process, but a production merchant should persist the
CML customer ID in its own integration records. A duplicate CML customer from
an earlier process is surfaced as a clear conflict.

## Demo safety

Catalogue reads are safe to exercise during QA. Customer creation and order
creation happen only after a user submits the checkout form. The Pay button
simulates the external provider but records a live captured CML payment. It can
mark the order Paid and trigger real licence jobs.
