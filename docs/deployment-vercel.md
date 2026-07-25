# Deploy the Next.js storefront to Vercel

The demo storefront is a Next.js App Router application in
`apps/demo-store`. Its page is static, while catalogue and checkout operations
run through Node.js Route Handlers.

## Vercel project settings

Import the repository as a monorepo project and use:

| Setting | Value |
| --- | --- |
| Root Directory | `apps/demo-store` |
| Framework Preset | Next.js |
| Include source files outside Root Directory | Enabled |
| Install Command | Automatic |
| Build Command | `npm run build` |
| Output Directory | Framework default; do not override |
| Node.js Version | `24.x` |

The app's `prebuild` script compiles `@cml-marketplace/core` and
`@cml-marketplace/server`, whose package exports point to generated `dist`
files. `vercel.json` selects the Next.js framework and intentionally does not
set a static output directory. The deployable app declares TypeScript and its
type packages directly in `devDependencies`; this is required because Vercel
installs the selected app workspace rather than the repository root's
development toolchain.

The Node.js engine is pinned to `24.x` so Vercel applies compatible minor and
security updates without automatically switching the application to a new
major runtime.

## Environment variables

Configure these separately for Preview and Production:

```text
CML_API_KEY
CML_API_SECRET
CML_CHANNEL_SLUG
CML_DEFAULT_COUNTRY
CML_API_BASE_URL
DATABASE_URL
CML_DEMO_MUTATIONS_ENABLED
CML_ALLOWED_ORIGINS
```

`CML_API_KEY`, `CML_API_SECRET`, and `DATABASE_URL` are server-only values.
Never expose them through a `NEXT_PUBLIC_` variable.

Keep `CML_DEMO_MUTATIONS_ENABLED=false` during the first deployment. The
catalogue remains testable, but customer, order, and payment writes are
blocked.

`CML_ALLOWED_ORIGINS` is optional. Same-origin browser requests are accepted
automatically. On Vercel, the application reconstructs the public same-origin
URL from `host`/`x-forwarded-host` and `x-forwarded-proto`, so custom domains
and deployment URLs do not depend on an internal Function URL.

Add comma-separated origins only when another trusted frontend must call the
mutation routes. Each entry must be a complete HTTP(S) origin without a path;
entries are normalized, so a trailing slash is harmless:

```text
CML_ALLOWED_ORIGINS=https://store.example.com,https://admin.example.com
```

Environment changes apply only to new deployments. Redeploy after changing
this variable.

### Troubleshoot rejected origins

If checkout displays `This request origin is not allowed`:

1. Confirm the latest origin-validation change is deployed.
2. Check that the browser is using the expected Preview, Production, or custom
   domain.
3. If the frontend and API are genuinely cross-origin, add the browser's exact
   origin to `CML_ALLOWED_ORIGINS` in the matching Vercel environment.
4. Redeploy and retry.

Do not use `*` and do not add untrusted domains. A request whose `Origin`
matches neither the public request host nor the configured allowlist still
returns `403`.

### Troubleshoot `tsc: command not found`

Deploy a revision that contains the app-local TypeScript development
dependencies in `apps/demo-store/package.json`. This error means the selected
app workspace was installed without the root workspace's TypeScript tooling.
Do not work around it by globally installing TypeScript in Vercel.

## Durable storage

Provision a Postgres database close to the Vercel Function region and assign
its pooled connection string to `DATABASE_URL`. The application creates
missing tables defensively on first use. The schema can also be applied
explicitly from the repository root:

```bash
npm run db:migrate -w @cml-marketplace/demo-store
```

The canonical schema is in `apps/demo-store/database/schema.sql`.

## Safe rollout

1. Deploy with mutations disabled.
2. Verify `/api/config` without exposing its server environment.
3. Verify a live catalogue read through `/api/catalog?country=FR`.
4. Confirm same-origin checkout requests pass and invalid-origin or
   disabled-mutation requests return `403`.
5. Connect a safe CML test organization and enable deployment protection.
6. Set `CML_DEMO_MUTATIONS_ENABLED=true` only in that protected environment.
7. Exercise preview and confirmation with a unique test email.
8. Exercise simulated success only when creating a real CML payment and
   licence job is intended.
9. Exercise simulated failure only when recording a failed payment and
   cancelling the live unpaid CML order is intended.
10. Promote the tested deployment to Production.

## Rollback

Promote the prior Vercel deployment or revert the migration commit. Do not
delete the Postgres records during rollback; they contain the customer links
and order state needed to avoid duplicate CML writes.

If a confirmation Function terminates after CML creates an order but before
the local transaction finishes, the preview remains claimed instead of being
automatically retried. This fails closed to avoid creating a duplicate CML
order. Reconcile that preview against CML before releasing or retrying it.

## Production safety checklist

- Deployment protection or merchant authentication is enabled.
- Mutation origins are restricted.
- Live-mutation flag is intentionally enabled.
- Postgres uses SSL and a serverless-compatible pooled connection.
- Function and database regions are close to the CML endpoint where possible.
- No CML secret appears in client bundles or browser-visible responses.
- The CML key has `ecommerce:orders:cancel` only when cancellation is enabled.
- Payment simulation and cancellation are disabled or access-controlled for
  public storefronts.
