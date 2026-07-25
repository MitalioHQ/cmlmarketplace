# Next.js migration record

The demo storefront was migrated from a Vite SPA with a custom development
server to a Next.js App Router application.

## Preserved contracts

- The storefront layout, styles, and cart behavior are preserved.
- Existing browser requests retain their `/api/*` paths and JSON shapes. The
  checkout adds a separate simulated-failure route and outcome.
- `@cml-marketplace/core`, `@cml-marketplace/catalog`, and
  `@cml-marketplace/server` remain reusable workspace packages.
- CML HMAC signing remains server-only.

## Replaced components

| Previous component | Next.js component |
| --- | --- |
| `index.html` and `src/main.tsx` | `app/layout.tsx` and `app/page.tsx` |
| `src/App.tsx` | `components/marketplace-app.tsx` Client Component |
| `src/demo-api.ts` | `lib/client/demo-api.ts` |
| `server/dev-server.mjs` | Six `app/api/**/route.ts` handlers |
| Process-global maps | `CommerceStore` with Postgres production storage |
| Manual `.env.local` parser | Server-only `@next/env` workspace loading |
| Vite `dist` output | Native Next.js build output |

## Verification gates

- Workspace package build
- TypeScript validation
- SDK unit tests
- CML response-mapping tests
- Store concurrency, idempotency, and rate-limit tests
- Route Handler preview, confirm, payment-success, and
  payment-failure/cancellation integration tests
- Same-origin, Vercel proxy-header, configured-origin, and rejected-origin
  security tests
- Next.js production build
- Browser hydration, live catalogue, cart, and disabled-checkout safety checks

The current automated workspace gate contains 24 tests and is run with:

```bash
npm run check
```
