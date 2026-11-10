# CLAUDE.md

Guide for any Claude session working in this repo. Read this first, then act.

## Project

**taha_supplier** — NestJS 11 REST backend for a B2B supplier/e-commerce app (products, brands, categories, cart, coupons, orders with payment-proof review, reviews, banners, shipping zones, customer profiles, admin customer management, push notifications). Clients are mobile apps (iOS/Android) and an admin dashboard.

## Stack

- **Runtime:** Node.js 22 (no `engines` field pinned yet)
- **Framework:** NestJS 11 (Express platform)
- **Language:** TypeScript (`module: nodenext`, `target: ES2023`, strictNullChecks on)
- **ORM:** Prisma **7** with the new `prisma-client` generator (NOT `prisma-client-js`), using `@prisma/adapter-pg` driver adapter
- **Database:** PostgreSQL
- **Auth:** `@nestjs/jwt` (access 15m) + bcrypt (salt rounds 10) + refresh tokens (SHA256 hashed, 30d, rotated on refresh, revocable)
- **Uploads:** Multer, local disk. Public images at `./uploads/<folder>/` (served), payment receipts at `./private-uploads/<folder>/` (never served)
- **Push:** `firebase-admin` (FCM) with lazy init
- **Validation:** `class-validator` + `class-transformer` in DTOs, enforced by a global `ValidationPipe`

## Repo layout

```
prisma/
  schema.prisma            # generator + datasource only
  models/*.prisma          # split models (12 files)
  migrations/              # committed, applied with `prisma migrate deploy`
generated/prisma/          # Prisma client output — TRACKED in git, regenerated on build
uploads/                   # public images, tracked in git, served at /uploads/*
private-uploads/           # payment receipts, gitignored, NOT served (read via ownership-checked endpoint)
src/
  main.ts                  # bootstrap: ValidationPipe, ResponseInterceptor, CORS, PORT
  app.module.ts            # wires ConfigModule, ServeStaticModule (/uploads), JwtModule (global),
                           # all feature modules, global AuthGuard + RolesGuard
  app.controller.ts        # GET /home (CLIENT)
  prisma/
    prisma.service.ts      # PrismaService (extends PrismaClient with PrismaPg adapter)
    serializable-transaction.ts  # runSerializableTransaction() retry helper (P2034 only)
  guards/                  # auth.guard.ts, roles.guard.ts (both registered as APP_GUARD)
  decorators/              # @Public(), @Roles(...roles: string[])
  interceptors/            # ResponseInterceptor (global response envelope)
  utils/
    multer/
      multer.ts            # multerOptions(folder), privateMulterOptions(folder), validateImageFiles
      upload-paths.ts      # UploadFolder / PrivateUploadFolder enums, path + URL helpers
      private-files.ts     # deletePrivateFile(relativePath, logger) best-effort unlink
    security/              # hashPassword, comparePassword (bcrypt)
    error-message.ts       # getErrorMessage(unknown)
    email/                 # EMPTY — placeholder, no email service exists
  <feature>/               # auth, banner, brand, cart, category, coupon, customers, notification,
                           # order, product, profile, review, shipping-zone, sub-category
    <feature>.module.ts
    <feature>.controller.ts
    <feature>.service.ts
    dto/*.dto.ts
  order/                   # split further:
    order.service.ts       #   client side: create (checkout), findMyOrders, findMyOrder, cancel, replacePaymentProof
    order-admin.service.ts #   admin side: findAllOrders, findOneAdmin, findCancelledOrders, updateStatus,
                           #   updatePaymentStatus, getPaymentProofPath
    order.mapper.ts        #   formatOrderResponse (Decimal -> rounded number)
```

Module dependencies worth knowing: `CouponModule` exports `CouponService` (coupon eligibility rules) and is imported by `CartModule` and `OrderModule`. `AuthModule` exports `AuthService` (used by `profile` and `customers` to revoke refresh tokens). `NotificationModule` is imported by `OrderModule`.

## Prisma — important specifics

- Schema is **split**: `prisma/schema.prisma` holds only generator + datasource; every model is in `prisma/models/<name>.prisma`. When adding a model, create a new file there — don't cram it into `schema.prisma`.
- Generator output is `../generated/prisma` with `moduleFormat = "cjs"`. **Import from `../../generated/prisma/client.js` (not `@prisma/client`).** See `src/prisma/prisma.service.ts` for the pattern.
- The client is instantiated with the pg driver adapter:
  ```ts
  new PrismaPg({ connectionString: process.env.DATABASE_URL })
  ```
- `prisma.config.ts` (Prisma 7 style) reads `DATABASE_URL` via `dotenv/config`. There is no `datasource.url` in `schema.prisma` — it comes from `prisma.config.ts`.
- Create migrations with `npx prisma migrate dev --name <name>`. Apply in prod with `prisma migrate deploy` (already scripted as `npm run db:migrate`).
- Regenerate client: `npm run prisma:generate` (also runs as part of `npm run build`). `generated/prisma/` is committed, so a schema change produces a diff there too.
- For multi-statement writes that must be atomic under concurrency, use `runSerializableTransaction` from `src/prisma/serializable-transaction.ts` (Serializable isolation, retries only on Prisma `P2034`). Checkout is the reference usage.

### Models (short map)

Core: `User` (roles: CLIENT, ADMIN, DELIVERY, ORDERS_STAFF, ACCOUNTS_STAFF, SUPPORT; status: ACTIVE/BANNED with `block_reason`; optional `latitude`/`longitude`), `UserDevice` (FCM tokens, unique), `RefreshToken` (`token_hash` unique, `expires_at`, `revoked_at`).

Catalog: `Category` → `SubCategory` → `Product` → `ProductImage`. `Brand` ↔ `SubCategory` via join `BrandSubCategory`. `Product` money/rating columns are `Decimal`.

Commerce: `Cart` (1:1 User, optional `coupon_id`) → `CartItem` (unique per cart per product); `Coupon` (status ACTIVE/PAUSED, percentage `discount_value`, optional `min_order_amount`, `start_date`, `end_date`, `usage_limit`/`usage_count`) + `CouponUsage` (unique per user per coupon, unique per order); `Order` (status PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED, or CANCELLED / CLIENTCANCELLED; `payment_method` CASH/CARD; `payment_status` PENDING/APPROVED/REJECTED; `payment_proof_image` relative path under `private-uploads/`; Decimal `subtotal`, `discount_amount`, `shipping_fee`, `total_amount`; delivery address snapshot) + `OrderItem` (snapshots `product_name`, `product_unit`, `unit_price`, `total_price`); `ShippingZone` (`shipping_cost`, `is_active`, `display_order`).

Content: `Banner` → `BannerImage` with click actions (NONE, CATEGORY, PRODUCT, BRAND, FILTER, PAGE).

Social: `Review` (unique per product per user, cascade on both).

Enums live inline in the model files that own them.

## Auth model (what every protected endpoint assumes)

- `AuthGuard` and `RolesGuard` are **globally registered** (`src/app.module.ts`). Everything requires a Bearer JWT by default.
- Opt a route out of auth with `@Public()` (`src/decorators/public.decorator.ts`).
- Restrict a route to roles with `@Roles(UserRole.ADMIN, ...)` (`src/decorators/roles.decorator.ts`). The decorator is typed `...roles: string[]`, so both `UserRole.ADMIN` and the bare string `'ADMIN'` work (both styles exist in the codebase; prefer the enum). Without `@Roles`, any authenticated user passes. `@Roles` can also sit on the controller class.
- The guard puts `{ sub, email, role }` on `request.user`. In controllers, read the user id via `req.user.sub` (type: number).
- JWT secret: `JWT_SECRET` env var; falls back to `'defaultSecret'` only to avoid crash during boot — **never rely on this in prod**.
- `/auth` routes: `POST signup`, `POST login`, `POST refresh`, `POST logout` (all `@Public()`), `PATCH fcm-token` (CLIENT), `POST adminDashboard/signup` and `POST adminDashboard/login` (both `@Public()`, see rough edges).
- Refresh tokens are rotated on every `POST /auth/refresh` (old one revoked, new one issued). Banning a customer or changing a password revokes all of a user's refresh tokens via `AuthService.revokeAllRefreshTokens`.

## Request/response conventions

- **Global ValidationPipe**: `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`. DTOs must declare every field; unknown fields → 400. Use `@Type()` for number/boolean coercion. A handler whose `@Body()` is typed with an inline object type instead of a DTO class is **not** validated by the pipe.
- **Global ResponseInterceptor** (`src/interceptors/interceptor.ts`) wraps every response as `{ message, data }`:
  - Return `{ message, data }` from a service/controller → both used.
  - Return `{ message }` alone → `data: null`.
  - Return anything else → it becomes `data`, message defaults to `"Success"`.
  - Routes that stream with `@Res()` (e.g. `GET /order/:id/payment-proof`) bypass the envelope.
- **Pagination** (where it exists): query `page` / `per_page`, response `{ items, page, per_page, next_page, last_page, total }`. Implemented in `GET /product` (client), `GET /product/admin`, `GET /order/admin`, `GET /customers/admin`, `GET /review/:productId`.
- **Route ordering**: literal segments like `admin`, `admin/cancelled`, `search` are declared before `:id` routes in the same controller. Keep that order when adding routes.
- **CORS**: `origin: true, credentials: true` — reflects any origin. Tighten before production.
- **Port**: `process.env.PORT ?? 3000`.

## File uploads

- `src/utils/multer/multer.ts` + `src/utils/multer/upload-paths.ts`.
- **Public images**: `multerOptions(UploadFolder.X)` → 10 MB cap, MIME filter for `jpeg|jpg|png|webp`, filename `<uuid><ext>` written to `./uploads/<folder>/`. Folders: `brands`, `categories`, `products`, `sub-category`, `banners` (extend `UploadFolder` when adding one). Build the public URL with `getUploadPublicPath(folder, filename)` → `/uploads/<folder>/<file>`.
- **`/uploads/*` is served by the app**: `ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'uploads'), serveRoot: '/uploads' })` is registered in `src/app.module.ts`.
- **Private files (payment receipts)**: `privateMulterOptions(PrivateUploadFolder.PAYMENT_PROOFS)` writes to `./private-uploads/payment-proofs/`. The DB stores the relative path from `getPrivateUploadRelativePath(...)` (`private-uploads/<folder>/<file>`, no leading slash). This directory is gitignored and **not** served statically; clients read a receipt only through `GET /order/:id/payment-proof`, which checks ownership (or ADMIN role) and `res.sendFile`s it. Always resolve stored paths with `resolvePrivateUploadPath(...)` (returns `null` on traversal) before `sendFile`/`unlink`, and delete with `deletePrivateFile(...)` from `src/utils/multer/private-files.ts`.
- Also call `validateImageFiles(...)` in controllers as defense-in-depth.
- ⚠️ **Disk storage is not durable on ephemeral hosts (Railway, Fly, Render, Heroku).** Uploads vanish on redeploy. For production, mount persistent volumes at `./uploads` and `./private-uploads`, or migrate to object storage (S3 / R2 / Supabase Storage).

## Notifications (Firebase)

- `src/notification/notification.service.ts` lazy-inits `firebase-admin` on first use.
- Credentials: either `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON) **or** the triple `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`. The private key keeps `\n` escapes; the service un-escapes them.
- Public methods: `sendOrderCreatedNotification`, `sendOrderStatusChangedNotification`, `sendPaymentStatusUpdatedNotification`, `sendBroadcastNotification`. Sends batch in chunks of 500 via `sendEachForMulticast`.
- If credentials are missing, the service **does not throw** — it logs once and returns `{ requested, sent: 0, failed: 0 }`. Features depending on push should not break locally when Firebase isn't configured.
- Callers wrap the send in `try/catch` after the DB write commits so a push failure never fails the request (see `order.service.ts` / `order-admin.service.ts`).
- Device tokens are stored in `UserDevice` (upserted on signup/login via `AuthService.registerFcmToken`, or explicitly via `PATCH /auth/fcm-token`).
- `POST /notification/broadcast` (ADMIN) sends to every stored device.

## Adding a new feature module — checklist

1. Create `src/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, and `dto/`.
2. Import `<feature>Module` in `src/app.module.ts`.
3. Service: `constructor(private readonly prisma: PrismaService) {}` — import `PrismaModule` in the feature module (every existing module does).
4. DTOs: use `class-validator` decorators on a **class**. Any field not whitelisted is rejected by the global pipe. Coerce types with `@Type()`.
5. Controller:
   - Decide auth: default is protected. Use `@Public()` to open, `@Roles(UserRole.X)` to restrict.
   - For uploads: `@UseInterceptors(FileInterceptor('field', multerOptions(UploadFolder.X)))` + `validateImageFiles(...)` + `getUploadPublicPath(...)`. For files that must stay private, mirror `order.controller.ts` (`privateMulterOptions` + ownership-checked `@Res()` streaming route).
   - Declare literal routes (`admin`, `search`, ...) before `:id` routes.
   - Return plain objects or `{ message, data }`. Don't manually set response envelope — the interceptor does it.
6. Prisma model changes: add/edit a file in `prisma/models/`, then `npx prisma migrate dev --name <name>`. Commit the migration folder and the regenerated `generated/prisma/`.
7. Errors: throw `NotFoundException`, `ConflictException`, `BadRequestException`, `UnauthorizedException`. Don't manually throw `ForbiddenException` — leave that to `RolesGuard`.
8. Where you need the current user: `@Req() req` then `req.user.sub` (id) / `req.user.role`.
9. Lists that can grow: add `page`/`per_page` pagination from the start (copy `FindAdminProductsDto` + the `count`/`findMany` pattern in `product.service.ts`).

## Environment variables

Required:
- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET`
- `PORT` (optional; defaults to 3000; Railway sets this automatically)

Required for push notifications (one of the two):
- `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON string), **or**
- `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`

`.env` is gitignored. Never commit real credentials.

## Scripts

- `npm run start:dev` — watch mode (local)
- `npm run build` — `prisma generate && nest build` → outputs `dist/src/main.js`
- `npm run start:prod` — `node dist/src/main.js`
- `npm run db:migrate` — `prisma migrate deploy` (run before start in prod)
- `npm run prisma:generate` — regenerate client only
- `npm run lint` / `npm run format` / `npm test`

Tests: only the scaffolded `test/app.e2e-spec.ts` exists; there are no unit specs under `src/`. `npm run lint` currently reports pre-existing errors (mostly `no-unsafe-*` on `any`), so judge lint by "no new errors".

## Deployment notes (Railway)

- Build command: `npm run build`. Pre-deploy / release command: `npm run db:migrate`. Start command: `npm run start:prod`.
- Do **not** hardcode `PORT`; Railway injects it.
- `generated/prisma/` is committed and also regenerated during build; `dist/` is gitignored.
- Add `uploads/` **and** `private-uploads/` to a Railway Volume OR move to object storage before relying on uploads in prod.
- `FIREBASE_PRIVATE_KEY` must preserve `\n` sequences when pasted into Railway's env UI.
- Tighten CORS `origin` from `true` to an allowlist before going public.

## Known rough edges (verified against current code)

- `POST /auth/adminDashboard/signup` is `@Public()`, takes an inline-typed body (so the global ValidationPipe does not validate it), and creates a user with role ADMIN. Anyone who can reach the API can create an admin. Lock this down before exposing the API.
- `src/utils/email/` is empty — no email delivery exists.
- Unpaginated list endpoints: `GET /category`, `/category/admin`, `/brand`, `/brand/admin`, `/sub-category`, `/sub-category/admin`, `/banner`, `/coupon`, `/shipping-zone`, `/shipping-zone/admin`, `/product/search`, `/order` (client's own orders), `/order/admin/cancelled`. Add pagination when touching them.
- `MAX_FILE_SIZE` in `src/utils/multer/multer.ts` is 10 MB, but the inline comment and the `validateImageFiles` error message both still say 5 MB.
- JWT fallback secret `'defaultSecret'` exists for boot resilience; treat as a bug in prod.
- `Decimal` columns in Prisma (prices, totals) are passed around as JS `number` in DTOs and rounded with `Math.round` in responses — large-amount precision loss is possible.
- `@Roles()` accepts arbitrary strings; a typo like `@Roles('ADMNI')` compiles and silently locks everyone out.
- `README.md` is the untouched Nest scaffold README.

## When in doubt

- Mirror the closest existing module (e.g., for a CRUD + image upload module, copy the shape of `src/brand/`; for paginated admin lists, `src/product/` or `src/customers/`; for private files or concurrency-sensitive writes, `src/order/`).
- Read `src/app.module.ts` to understand what's globally wired.
- Read `src/main.ts` to understand the response envelope and validation rules before designing a new endpoint's contract.
