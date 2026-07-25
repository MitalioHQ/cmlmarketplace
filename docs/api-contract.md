# CML E-Commerce API contract

Base URL:

```text
https://vwqretlvkrravzguxydw.functions.eu-west-2.nhost.run/v1
```

All operations below are server-to-server `POST` requests authenticated with
the CML HMAC headers.

## Catalogue

`POST /sales-channel/catalog`

```json
{
  "channel": "northstar",
  "country_code": "FR"
}
```

Required scope: `ecommerce:read`.

The response contains `available`, the channel, and products in saved channel
order. A restricted country returns HTTP 200 with `available: false`.

## Customer

`POST /order/customer`

```json
{
  "customer": {
    "email": "customer@example.com",
    "first_name": "Mina",
    "last_name": "Vein",
    "country_code": "FR"
  }
}
```

Required scope: `ecommerce:customers:write`.

Email must be unique within the organization. The current API does not expose
lookup-by-email or an upsert endpoint.

## Preview and submit

`POST /order/submit`

Preview:

```json
{
  "preview": true,
  "order": {
    "customer_id": 42,
    "sales_channel": "northstar",
    "items": [{ "product_id": 15, "qty": 1 }]
  }
}
```

Omit `preview` to create the order in Draft status. Required scope:
`ecommerce:orders:write`.

## Confirm

`POST /order/confirm`

```json
{ "order_id": 114 }
```

This moves a Draft order to Pending Payment. Required scope:
`ecommerce:orders:write`.

## Cancel

`POST /order/cancel`

```json
{
  "order_id": 114,
  "notes": "Provider payment failed before capture."
}
```

Required scope: `ecommerce:orders:cancel`. Cancelling an unpaid Pending Payment
order moves it to Cancelled. CML also supports refund and licence-deactivation
options for paid orders, but those options are intentionally outside this
demo's payment-failure flow.

## Read

`POST /order/get`

```json
{ "order_code": "ORD260720123456ABC" }
```

Required scope: `ecommerce:read`. The response uses stored line-item snapshots.

## Record payment

`POST /order/payment`

```json
{
  "payment": {
    "order_code": "ORD260720123456ABC",
    "provider": "paypal",
    "provider_txn_id": "PAYMENT-UNIQUE-ID",
    "amount": "99.00",
    "status": 1,
    "payment_method": "card"
  }
}
```

Required scope: `ecommerce:payments:record`. Status `1` is captured, `2` is
failed, and `3` is refund. `provider_txn_id` must be globally unique.

The merchant must verify the provider webhook before making this call. A
captured payment that covers the order total marks the order Paid and queues
licence creation. Recording status `2` creates a failed-payment record but does
not itself change the order status; the merchant must cancel the order
separately when its business rules require cancellation.

## Money

The public CML API uses decimal strings or numbers. SDK-facing models convert
them to integer minor units:

```json
{ "amountMinor": 9900, "currency": "USD" }
```

The browser never submits a trusted price; CML calculates every preview and
order from current product/channel data.
