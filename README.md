# Mizmar Optical

Optical-store platform: a public **storefront** and an **admin ERP** (POS, inventory, purchasing, lens workshop,
appointments, HR, finance, reports), fully configurable from the dashboard.

> **Status: Phases 1–5 of 7 complete** — foundations; catalog, products, inventory, customers, prescriptions; the
> **point of sale** (register sessions, checkout, prescription orders with deposits, returns, quotes, invoices); and
> **purchasing + workshop** (suppliers, purchase orders, goods receipts, supplier invoices/payments, lens-lab job orders).
> **storefront commerce + appointments** (public catalog, lens configurator, cart/coupons, checkout, accounts, booking). HR, finance and reports arrive in phases 6–7 (see [Roadmap](#roadmap)).

| Part | Stack | Port |
|---|---|---|
| `apps/api` | NestJS 12, Prisma 7, PostgreSQL 17, Redis + BullMQ, S3 storage, Swagger | **3001** |
| `apps/admin` | Next.js 16 (App Router), Tailwind 4, shadcn-style UI, TanStack Query, RHF + Zod, next-intl | **3002** |
| `apps/web` | Next.js 16 storefront, server-rendered, SEO, next-intl | **3000** |
| `packages/shared` | Permission catalog, Zod schemas, locale constants (used by all three) | — |
| `packages/config` | Shared Tailwind theme tokens | — |

Languages: **French (default), Arabic (RTL), English**. Currency **MAD**, VAT 20 %, metric units.

## Prerequisites

- Node.js ≥ 22 (developed on 24)
- A container engine with compose: **Docker** or **Podman** (+ `podman-compose`)
- pnpm 12 — enable it with corepack:
  ```bash
  corepack enable pnpm                              # if this fails with EACCES (system Node):
  corepack enable --install-directory ~/.local/bin pnpm   # …and make sure ~/.local/bin is on PATH
  ```

## Quick start

```bash
cp .env.example .env            # defaults work for local development
pnpm install                    # also builds @mizmar/shared and generates the Prisma client (`prepare` hook)
pnpm infra:up                   # Postgres :5433, Redis :6380, S3 storage :9000 (console :9001)
pnpm db:migrate                 # apply migrations
pnpm db:seed                    # demo data + default super-admin (safe to re-run)
pnpm dev                        # api + admin + web with hot reload
```

Open:

- Admin — http://localhost:3002 (redirects to `/fr`)
- Storefront — http://localhost:3000
- API docs (Swagger) — http://localhost:3001/docs

### Default credentials (change them!)

| Account | Email | Password | Access |
|---|---|---|---|
| Super admin | `SEED_ADMIN_EMAIL` (default `admin@mizmar.local`) | `SEED_ADMIN_PASSWORD` from your `.env` (`.env.example` ships `Password!`) | everything, all stores |
| Store manager | `manager@mizmar.local` | `Demo!2026pass` | Casablanca store |
| Optician | `optician@mizmar.local` | `Demo!2026pass` | Casablanca store |
| Technician | `technician@mizmar.local` | `Demo!2026pass` | Casablanca store |
| Cashier | `cashier@mizmar.local` | `Demo!2026pass` | Casablanca store |

The demo accounts exist to try role-based access (e.g. log in as the cashier and see the sidebar shrink).
**Delete or re-password them — and change the super-admin password — before any real deployment.** The seed only creates
the super admin if it doesn't exist yet, so editing `SEED_ADMIN_PASSWORD` later does not change an existing account.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` / `build` | Run / build every app (Turborepo) |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` | Quality gates |
| `pnpm --filter @mizmar/api test:e2e` | API end-to-end tests; migrates + seeds the isolated `mizmar_test` database itself |
| `pnpm db:migrate` · `db:seed` · `db:studio` | Prisma migrate (dev) / seed / browser DB UI |
| `pnpm --filter @mizmar/api db:deploy` | Apply migrations in production (`migrate deploy`) |
| `pnpm infra:up` · `infra:down` · `infra:logs` | Manage the containers |
| `python3 scripts/gen-schema-doc.py` | Regenerate [docs/schema.md](docs/schema.md) from the Prisma schema |

## Architecture notes

- **Database** — 123 models in `apps/api/prisma/schema/*.prisma`, split by domain; overview in
  [docs/schema.md](docs/schema.md). Every table has `createdAt/updatedAt/deletedAt`.
- **Soft delete** — use `prisma.db` (a Prisma client extension that hides deleted rows and turns `delete` into an
  update). `prisma.raw` bypasses it (seeds, maintenance, audit). Unique business keys are suffixed on delete
  (`email#del-<id>`) so they can be reused.
- **Auth** — 15 min JWT access token + 7 day **rotating** refresh token (stored hashed; replaying a used token revokes
  the whole token family). 5 failed logins lock the account for 15 min. Auth routes have a stricter rate limit.
- **RBAC** — permissions are `module:action` keys defined once in
  [packages/shared/src/permissions.ts](packages/shared/src/permissions.ts), seeded into the DB, enforced by
  `@Permissions('users:create')` on the API and used to filter the admin navigation. Super admins bypass checks.
- **Multi-store** — clients send `x-store-id`; the guard verifies the user belongs to that store. Store-bound data is
  scoped with `@CurrentStore()`.
- **Audit** — every successful mutating request is recorded (bodies redacted); login events are logged explicitly.
- **Everything list-shaped** uses `PaginationDto` + `paginate()` (`page/limit/search/sortBy/sortOrder`, sort columns
  are whitelisted) — copy `modules/users` when adding a module.
- **Storefront customization** — branding colors/fonts, menus, home sections, banners, pages and testimonials are
  database rows served by `GET /api/v1/public/*`; the website re-fetches them every 30 s.
- **Queues** — BullMQ `mail` / `sms` / `notification`. In development, emails and SMS are rendered from the
  dashboard-editable templates and **logged to the API console** (no SMTP configured yet).

## What phase 2 added

| Area | API (Swagger tag) | Admin screen |
|---|---|---|
| Reference data | `brands`, `categories`, `frame-shapes`, `frame-materials`, `lens-types`, `lens-treatments`, `lens-entries` | **Catalog** (one tab per table) |
| Products | `products` — variants, images, frame specs, opening stock, `GET /products/lookup/:barcodeOrSku` | **Products** (list + filters, editor, variants, image upload) |
| Inventory | `inventory` — stock levels, ledger, adjustments, transfers (draft → in transit → received), counts, `warehouses` | **Stock** (overview, movements, adjustments, transfers, counts) |
| Customers | `customers` — duplicates detection, addresses, notes, insurance, CSV export | **Customers** (list + detail tabs) |
| Prescriptions | `prescriptions` — OD/OS, validated against optical rules (0.25 steps, axis ⇔ cylinder, ranges) | tab on the customer page |
| Files | `POST /media?folder=` — type checked by file signature, 5 MB cap | used by product images and prescription scans |

Design rules worth knowing before adding modules:

- **All stock changes go through `StockService.move()`.** It does one atomic conditional update (no overselling under
  concurrency) and appends an immutable `StockMovement` with the resulting balance. POS, purchasing and the workshop
  will call it too; never write `StockLevel` directly.
- **Document numbers** (`CASA-TRF-2026-000042`) come from `NumberingService.next(tx, storeId, type)` inside the
  transaction that creates the document. Prefix, padding and reset policy are editable per store (`DocumentSequence`).
- **Simple reference tables** are built with `SimpleCrudService` + `createCrudController` (see `modules/catalog`): a
  config object, two DTOs and one line in the module. Validation still applies (DTOs are registered as route metadata).
- **Store scoping:** stock and documents are limited to the stores a user belongs to; super admins see everything.
- **Money and dioptres** are `Decimal` in the database and plain JSON numbers in API responses.

## What phase 3 added (POS, sales, invoices)

| Area | API | Admin screen |
|---|---|---|
| Register sessions | `pos/sessions` — open with a float, cash in/out, live **X** report, close with counted cash → variance + frozen **Z** report; `pos/reports/daily` | **Caisse** (session bar) · **Caisses & clôtures** |
| Checkout | `POST /pos/price` (exact preview), `POST /pos/checkout` — split tenders, discounts (`pos:discount`), prescription lenses, deposits | **Caisse** (search/scan, cart, lens configurator, payment dialog, parked sales) |
| Orders | `orders` — list/filter, detail, `payments` on a balance, `deliver`, `cancel`, `returns` (+ refunds, credit notes) | **Commandes** (+ *Achats* tab on a customer) |
| Quotes | `quotes` — draft → sent → accepted → converted at checkout (`quoteId`) | **Devis** |
| Invoices & printing | `invoices`, `…/document`, `orders/:id/receipt` → printable HTML in fr/en/ar | **Factures**, print buttons |

How the money side works — worth knowing before touching it:

- **The server prices everything.** Clients send variant ids, quantities, discounts and lens choices; never prices. Amounts are
  integer cents ([packages/shared/src/pricing.ts](packages/shared/src/pricing.ts)), tax-inclusive by default, rounded half-up
  per line so invoice lines always add up. `POST /pos/price` runs the same code path the checkout charges, so the screen can't differ.
- **Checkout is one transaction**: order + lines + lens config + stock (`StockService`) + numbered invoice + payments + drawer
  movement. A failure anywhere (e.g. not enough stock for the last line) leaves nothing behind.
- **Retries are safe**: the till sends a `clientRef` per attempt; resubmitting it (double-click, flaky network, two tabs) returns the original order.
- **Prescription orders** may be paid with a deposit (`pos.min_deposit_pct`, default 30%); the balance stays on the order until
  paid, and the order can only be handed over at zero balance. Lens choices are validated against the prescription
  (expired, ADD for progressives, power range of the chosen lens, treatments offered) and a snapshot is stored.
- **Cash accountability**: cash payments/refunds/in/out all write signed drawer movements; expected cash = float + movements.
  A sale needs an open session (`pos.require_open_session`, default on). Card/transfer money never enters the drawer total.
- **Returns** refund exactly what was paid, to the cent (the last unit takes the rounding remainder), put stock back unless
  damaged, and issue a credit note. Refunds need `pos:refund`; cash refunds also need the cash to be in the drawer.
- **Documents** use a small safe template engine ([documents/template-engine.ts](apps/api/src/modules/documents/template-engine.ts)):
  every value is HTML-escaped, there is no raw output and no code execution, so a customer name can't inject markup. Templates are
  editable per store (`DocumentTemplate`); built-ins are the fallback.
- Settings you can change (group `pos`): `require_open_session`, `min_deposit_pct`, `allow_negative_stock`; `checkout.prescription_required_for_lenses`.

## What phase 4 added (purchasing, workshop)

| Area | API | Admin screen |
|---|---|---|
| Suppliers | `suppliers` CRUD (unique code, payment terms, `isLensLab`), `GET suppliers/:id/statement` | **Fournisseurs** |
| Purchase orders | `purchase-orders` — draft → send → receive; costs entered **excl. tax**; `GET :id/document` prints the PO | **Achats** (orders, detail, receive dialog) |
| Goods receipts | `purchase-orders/:id/receipts` (partial deliveries), `goods-receipts` (direct, no PO), `…/void` | **Achats → Bons de réception** |
| Supplier invoices | `supplier-invoices` — unique per (supplier, supplier ref); lines matched to received goods | **Factures fournisseurs** |
| Supplier payments | `supplier-invoices/:id/payments` — partial/full, never above the balance; `purchasing/summary` | same screen |
| Workshop | `jobs` — a job per prescription line is created **inside the checkout transaction**; manual jobs for the customer's own frame | **Atelier** (kanban board + job page) |

- **Receiving** locks the order row, refuses more than is outstanding, adds stock through `StockService.move()`
  (`PURCHASE_RECEIPT`, with the unit cost) and keeps a weighted-average cost. Voiding a receipt reverses the stock
  (`SUPPLIER_RETURN`) unless it is already invoiced.
- **3-way match:** an invoice line linked to a receipt line cannot exceed what was received and not yet invoiced.
- **Workshop flow:** pending → lenses ordered → lenses received → cutting/mounting → quality check → ready → delivered
  (plus on hold / cancelled). Rules enforced by the API: a technician is assigned before cutting, every task is done before the
  quality check, a failed check returns the job to the bench with notes, and READY is reachable only through a passed check.
  Lab lens orders drive the job (ordered/received/defective). When a job becomes ready the customer is notified by the
  channels in `workshop.notify_channels` (default email + SMS; delivery is logged until providers are configured).
- **Hand-over:** `POST orders/:id/deliver` is refused (`JOBS_NOT_READY`) until every prescription pair is ready, then delivers
  the jobs with the order; cancelling an order cancels its jobs. Default lead time: lens `leadTimeDays`, else setting
  `workshop.default_days` (5).
- Roles: technicians can self-assign and run the bench; assigning others needs `workshop:assign`; supplier-invoice payment
  needs `finance:approve` (accountants). New screens/permissions follow the existing module catalog.

## What phase 5 added (storefront commerce, appointments)

| Area | API | Where |
|---|---|---|
| Catalog | `public/products` (filters: type, brand, category, gender, shape, material, colour, size, price, in-stock; sort), `public/facets`, `public/products/:slug`, `public/lens-options` | **web** `/catalogue`, `/produit/[slug]` |
| Lens configurator | prescription saved to the customer's account (typed, or an uploaded scan), priced by `public/cart/quote` | product page |
| Cart & checkout | `public/cart/quote` (server prices, coupons, delivery zones), `public/checkout` (guest or account; COD, bank transfer, pluggable online providers) | `/panier`, `/commande` |
| Tracking | `public/orders/track` (order number **and** the email/phone used) | `/suivi` |
| Accounts | `public/auth/register`, shared `auth/login`, `account/*` (profile, addresses, wishlist, prescriptions, orders + cancel, reviews, appointments) | `/compte/*` |
| Appointments | `public/appointments/{types,practitioners,slots}`, booking, lookup/cancel; staff `appointments`, calendar, `practitioners/:id/availability` + `time-off`, `appointment-types` | `/rendez-vous`; admin **Rendez-vous** |
| Content | `public/blog`, `public/contact` (honeypot), `public/newsletter` | `/blog`, `/contact` |
| Staff tools | online fulfilment (`orders/:id/{confirm-payment,ship,shipment-delivered,ready-for-pickup}`), `coupons`, `shipping-methods`, `reviews` + `contact-messages` moderation | admin order page, **Promotions & livraison**, **Avis & messages** |

- **Customers and staff share one login system, with a wall between them.** Every route refuses a customer token unless it opts in
  (`@AllowCustomer` / `@CustomerOnly`), and `@CustomerOnly` routes refuse staff. So a customer can never reach an admin endpoint, even one
  someone forgot to put a permission on. Covered by an e2e test over a dozen staff routes.
- **The server prices everything.** The cart in the browser carries display data only; `cart/quote` and `checkout` re-read prices, apply the
  coupon (spread over lines to the cent), shipping (free-over thresholds, city zones) and VAT. Stock is taken in the same transaction
  (`StockService`, race-safe: parallel buyers of the last pair → exactly one wins). Retrying a checkout with the same `clientRef` returns the
  same order. Coupon limits are re-checked under a row lock.
- **Prescription lenses online** require an account (the prescription lives there). A typed or scanned prescription is flagged on the
  workshop ticket ("à vérifier") until an optician verifies it; the existing workshop flow takes over.
- **Appointments** are computed in the store's timezone from each practitioner's weekly hours, minus bookings (with buffers) and time off,
  with minimum notice / horizon / cancel-window settings (`appointments.min_notice_hours`, `max_days_ahead`, `cancel_hours`, `auto_confirm`).
  Booking takes a per-practitioner lock, so simultaneous requests for one slot can't both succeed. A 24-hour reminder email is sent by an hourly
  BullMQ job.
- **Payments:** cash on delivery / at the store and bank transfer work out of the box. Online cards use a provider interface
  (`modules/shop/payment-providers.ts`); only a **simulated `demo` provider** ships (development only, refused in production). A real gateway
  (CMI, Stripe, PayPal) is one class that returns `CAPTURED` or a redirect URL.
- Not built yet: real payment gateway, SMS/WhatsApp sending (queued and logged), email verification at sign-up, WhatsApp/Google reviews import.

## Troubleshooting

- **`ERR_PNPM_IGNORED_BUILDS` (install exits 1)** — pnpm 12 refuses to finish installing when a dependency has an
  install script nobody has approved or denied. This repo records an explicit decision in `pnpm-workspace.yaml`
  (`allowBuilds`: all `false` — none of them needs a script here; Prisma 7 uses a query compiler, no engine download).
  If you add a dependency that triggers the error, review it and run `pnpm approve-builds` (or `pnpm approve-builds '!pkg'`
  to deny).
- **Podman instead of Docker** — works as-is (`docker compose` → `podman-compose`). Compose uses fully-qualified image
  names for this reason. If a published port is taken, change it in `docker-compose.yml` and `.env`.
- **Object storage image** — MinIO withdrew its public container images, so local dev uses **RustFS**
  (S3-compatible, same ports/credentials). Any S3 endpoint works: set `S3_*` in `.env`. The API creates the bucket on
  startup.
- **`Cannot find module './internal/class.ts'`** — the generated Prisma client imports `.ts` files; the API's
  `tsconfig.json` sets `rewriteRelativeImportExtensions` to handle this. Don't remove it.
- **Jest + Nest 12** — Nest 12 is ESM; the test scripts run Jest with `--experimental-vm-modules`.
- **Port already in use / stale server** — `pnpm infra:down && pnpm infra:up`, and check `ss -ltnp | grep -E '300[012]'`.

## Security notes / known hardening items

- **Rate limits** (`THROTTLE_*` in `.env`): signed-in traffic is limited **per user** (default 600/min) so colleagues
  sharing one shop router don't lock each other out; anonymous traffic is limited per IP. Password endpoints
  (`login`, `forgot-password`, `reset-password`) have a much stricter per-IP limit (`THROTTLE_AUTH_LIMIT`, default
  10/min). `auth/refresh` is deliberately *not* in that strict bucket: its token is unguessable and every page load
  calls it. If the API sits behind a reverse proxy, enable Express `trust proxy` so `req.ip` is the real client.
- **Uploads** are validated by file signature, never by the client's Content-Type or file name; PDFs are only accepted
  for prescriptions. Files are stored under random keys in a public-read bucket — do not upload anything private there.

- Admin keeps the **refresh token in `localStorage`** (access token in memory). That is simple but readable by any XSS;
  before production, move the refresh token to an `httpOnly` cookie via a Next.js route handler (BFF).
- CMS page HTML is rendered as authored by trusted staff; add server-side sanitisation when the page editor lands.
- Replace all `.env.example` secrets (`JWT_*`, S3, seed passwords) and set real `CORS_ORIGINS`.

## Roadmap

1. ✅ **Foundations** — monorepo, infra, schema, auth + RBAC, seed, admin + storefront shells
2. ✅ **Products, inventory, customers, prescriptions**
3. ✅ **POS, sales, invoices**
4. ✅ **Purchasing, workshop / fabrication**
5. ✅ **Storefront commerce (catalog, lens configurator, checkout), appointments**
6. HR, finance, reports
7. Full settings UI, i18n polish, tests, hardening
