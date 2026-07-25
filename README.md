# CML Marketplace

CML Marketplace is a headless commerce SDK and reference storefront for
CheckMyLicense merchants.

CheckMyLicense (CML) is the system of record for the catalogue, customers,
orders, payment records, and licence fulfilment. The merchant owns the
storefront, payment-provider checkout, and provider webhook validation.

## Packages

- `@cml-marketplace/core` — shared types, exact money helpers, and immutable
  cart operations.
- `@cml-marketplace/catalog` — browser-safe client for a merchant catalogue
  proxy. It never receives a CML API secret.
- `@cml-marketplace/server` — server-only, HMAC-signed client for the deployed
  CML E-Commerce API.
- `@cml-marketplace/demo-store` — Next.js reference storefront with live
  northstar catalogue and server-only order routes.

## Start the demo

```bash
npm install
copy .env.example .env.local
npm run dev
```

Set `CML_API_KEY` and `CML_API_SECRET` in the ignored `.env.local` file. The
demo is served at `http://127.0.0.1:4173/`.

Checkout writes are disabled by default. Durable checkout requires
`DATABASE_URL`, and live customer/order/payment operations require the explicit
`CML_DEMO_MUTATIONS_ENABLED=true` safety flag. Do not enable that flag on a
public deployment until access controls and a safe CML tenant have been
verified.

Production mutation routes enforce same-origin requests. Additional trusted
frontend origins can be listed in `CML_ALLOWED_ORIGINS`; Vercel environment
changes require a redeployment.

Without credentials it renders an empty configuration state. It never
substitutes local products. With credentials it performs the documented
sequence:

1. Load `northstar` through `/sales-channel/catalog`.
2. Create the customer with `/order/customer`.
3. Preview using `/order/submit` with `preview: true`.
4. Submit the order as Draft using `/order/submit`.
5. Confirm it to Pending Payment using `/order/confirm`.

The demo checkout offers two simulated provider outcomes. Success calls CML's
live payment endpoint and can mark the order Paid and enqueue real licence
jobs. Failure records a declined payment, then cancels the still-unpaid CML
order. Both paths are live CML mutations even though no external money is
collected.

## Validate the workspace

```bash
npm run check
```

## Server usage

```ts
import { createCmlApiClient } from "@cml-marketplace/server";

const cml = createCmlApiClient({
  apiKey: process.env.CML_API_KEY!,
  apiSecret: process.env.CML_API_SECRET!,
});

const catalogue = await cml.getCatalog({
  channel: "northstar",
  country_code: "FR",
});
```

The client signs the exact request body with HMAC-SHA256. The secret is never
sent to CML and must never be bundled into browser code.

See [Architecture](docs/architecture.md) and
[API contract](docs/api-contract.md) for the boundaries. Start with the
[merchant user guide](docs/user-guide.md) when integrating another storefront.
See [Vercel deployment](docs/deployment-vercel.md) for database, environment,
security, rollout, and rollback instructions.
