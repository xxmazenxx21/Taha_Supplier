# CLAUDE.md

Guide for any Claude session working in this repo. Read this first, then act.

## Project

**taha_supplier** — NestJS 11 REST backend for a B2B supplier/e-commerce app (products, brands, categories, cart, coupons, orders, reviews, banners, shipping zones, push notifications). Clients are mobile apps (iOS/Android) and an admin dashboard.

## Stack

- **Runtime:** Node.js 22 (no `engines` field pinned yet)
- **Framework:** NestJS 11 (Express platform)
- **Language:** TypeScript (`module: nodenext`, `target: ES2023`, strictNullChecks on)
- **ORM:** Prisma **7** with the new `prisma-client` generator (NOT `prisma-client-js`), using `@prisma/adapter-pg` driver adapter
- **Database:** PostgreSQL
- **Auth:** `@nestjs/jwt` (access 15m) + bcrypt (salt rounds 10) + refresh tokens (SHA256 hashed, 30d, anti-replay)
- **Uploads:** Multer, local disk storage at `./uploads/<folder>/`
- **Push:** `firebase-admin` (FCM) with lazy init
- **Validation:** `class-validator` + `class-transformer` in DTOs, enforced by a global `ValidationPipe`

## Repo layout

```
prisma/
  schema.prisma            # generator + datasource only
  models/*.prisma          # split models (12 files)
  migrations/              # committed, applied with `prisma migrate deploy`
generated/prisma/          # Prisma client output (gitignored, regenerated on build)
src/
  main.ts                  # bootstrap: ValidationPipe, ResponseInterceptor, CORS, PORT
  app.module.ts            # wires ConfigModule, JwtModule (global), all feature modules, global AuthGuard + RolesGuard
  prisma/                  # PrismaService (extends PrismaClient with PrismaPg adapter)
  guards/                  # auth.guard.ts, roles.guard.ts (both registered as APP_GUARD)
  decorators/              # @Public(), @Roles(...UserRole)
  interceptors/            # ResponseInterceptor (global response envelope)
  utils/
    multer/                # multerOptions(folder), validateImageFiles, UploadFolder enum, path helpers
    security/              # hashPassword, comparePassword (bcrypt)
    email/                 # EMPTY — placeholder, no email service exists
  <feature>/               # auth, banner, brand, cart, category, coupon, notification,
                           # order, product, review, shipping-zone, sub-category
    <feature>.module.ts
    <feature>.controller.ts
    <feature>.service.ts
    dto/*.dto.ts
```

## Prisma — important specifics

- Schema is **split**: `prisma/schema.prisma` holds only generator + datasource; every model is in `prisma/models/<name>.prisma`. When adding a model, create a new file there — don't cram it into `schema.prisma`.
- Generator output is `../generated/prisma` with `moduleFormat = "cjs"`. **Import from `../../generated/prisma/client.js` (not `@prisma/client`).** See `src/prisma/prisma.service.ts` for the pattern.
- The client is instantiated with the pg driver adapter:
  ```ts
  new PrismaPg({ connectionString: process.env.DATABASE_URL })
  ```
- `prisma.config.ts` (Prisma 7 style) reads `DATABASE_URL` via `dotenv/config`. There is no `datasource.url` in `schema.prisma` — it comes from `prisma.config.ts`.
- Create migrations with `npx prisma migrate dev --name <name>`. Apply in prod with `prisma migrate deploy` (already scripted as `npm run db:migrate`).
- Regenerate client: `npm run prisma:generate` (also runs as part of `npm run build`).

### Models (short map)

Core: `User` (roles: CLIENT, ADMIN, DELIVERY, ORDERS_STAFF, ACCOUNTS_STAFF, SUPPORT; status: ACTIVE/BANNED), `UserDevice` (FCM tokens, unique), `RefreshToken` (hashed, expiring).

Catalog: `Category` → `SubCategory` → `Product` → `ProductImage`. `Brand` ↔ `SubCategory` via join `BrandSubCategory`.

Commerce: `Cart` (1:1 User) → `CartItem`; `Coupon` + `CouponUsage` (unique per user per coupon, unique per order); `Order` + `OrderItem` (snapshots `product_name`, `product_unit`, `unit_price`); `ShippingZone`.

Content: `Banner` → `BannerImage` with click actions (NONE, CATEGORY, PRODUCT, BRAND, FILTER, PAGE).

Social: `Review` (unique per product per user, cascade on both).

Enums live inline in the model files that own them.

## Auth model (what every protected endpoint assumes)

- `AuthGuard` and `RolesGuard` are **globally registered** (`src/app.module.ts`). Everything requires a Bearer JWT by default.
- Opt a route out of auth with `@Public()` (`src/decorators/public.decorator.ts`).
- Restrict a route to roles with `@Roles(UserRole.ADMIN, ...)` (`src/decorators/roles.decorator.ts`). Without `@Roles`, any authenticated user passes.
- The guard puts `{ sub, email, role }` on `request.user`. In controllers, read the user id via `req.user.sub` (type: number).
- JWT secret: `JWT_SECRET` env var; falls back to `'defaultSecret'` only to avoid crash during boot — **never rely on this in prod**.
- Login/signup live under `/auth`; refresh is `POST /auth/refresh` and is `@Public()`.

## Request/response conventions

- **Global ValidationPipe**: `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`. DTOs must declare every field; unknown fields → 400. Use `@Type()` for number/boolean coercion.
- **Global ResponseInterceptor** (`src/interceptors/interceptor.ts`) wraps every response as `{ message, data }`:
  - Return `{ message, data }` from a service/controller → both used.
  - Return `{ message }` alone → `data: null`.
  - Return anything else → it becomes `data`, message defaults to `"Success"`.
- **CORS**: `origin: true, credentials: true` — reflects any origin. Tighten before production.
- **Port**: `process.env.PORT ?? 3000`.

## File uploads

- `src/utils/multer/multer.ts` + `src/utils/multer/upload-paths.ts`.
- `multerOptions(UploadFolder.X)` returns a Multer config: 10 MB cap, MIME filter for `jpeg|jpg|png|webp`, filename = `<uuid><ext>` written to `./uploads/<folder>/`.
- Folders: `brands`, `categories`, `products`, `sub-category`, `banners` (extend `UploadFolder` enum when adding a new one).
- After upload, build the public URL with `getUploadPublicPath(folder, filename)` → `/uploads/<folder>/<file>`.
- Also call `validateImageFiles(...)` in controllers as defense-in-depth.
- ⚠️ **`@nestjs/serve-static` is installed but NOT wired into `AppModule`.** `/uploads/*` URLs are not actually served by the app. They work only if a reverse proxy serves them, or you register `ServeStaticModule.forRoot({ rootPath: join(process.cwd(), 'uploads'), serveRoot: '/uploads' })`.
- ⚠️ **Disk storage is not durable on ephemeral hosts (Railway, Fly, Render, Heroku).** Uploads vanish on redeploy. For production, either mount a persistent volume at `./uploads` or migrate to object storage (S3 / R2 / Supabase Storage).

## Notifications (Firebase)

- `src/notification/notification.service.ts` lazy-inits `firebase-admin` on first use.
- Credentials: either `FIREBASE_SERVICE_ACCOUNT_JSON` (full JSON) **or** the triple `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`. The private key keeps `\n` escapes; the service un-escapes them.
- Public methods: `sendOrderCreatedNotification`, `sendOrderStatusChangedNotification`, `sendBroadcastNotification`. Sends batch in chunks of 500 via `sendEachForMulticast`.
- If credentials are missing, the service **does not throw** — it logs once and returns `{ requested, sent: 0, failed: 0 }`. Features depending on push should not break locally when Firebase isn't configured.
- Device tokens are stored in `UserDevice` (upserted on signup/login via `AuthService.registerFcmToken`).

## Adding a new feature module — checklist

1. Create `src/<feature>/` with `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`, and `dto/`.
2. Import `<feature>Module` in `src/app.module.ts`.
3. Service: `constructor(private readonly prisma: PrismaService) {}` — PrismaModule is already provided.
4. DTOs: use `class-validator` decorators. Any field not whitelisted is rejected by the global pipe. Coerce types with `@Type()`.
5. Controller:
   - Decide auth: default is protected. Use `@Public()` to open, `@Roles(UserRole.X)` to restrict.
   - For uploads: `@UseInterceptors(FileInterceptor('field', multerOptions(UploadFolder.X)))` + `validateImageFiles(...)` + `getUploadPublicPath(...)`.
   - Return plain objects or `{ message, data }`. Don't manually set response envelope — the interceptor does it.
6. Prisma model changes: add/edit a file in `prisma/models/`, then `npx prisma migrate dev --name <name>`. Commit the migration folder.
7. Errors: throw `NotFoundException`, `ConflictException`, `BadRequestException`, `UnauthorizedException`. Don't manually throw `ForbiddenException` — leave that to `RolesGuard`.
8. Where you need the current user: `@Req() req` then `req.user.sub` (id) / `req.user.role`.

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

## Deployment notes (Railway)

- Build command: `npm run build`. Pre-deploy / release command: `npm run db:migrate`. Start command: `npm run start:prod`.
- Do **not** hardcode `PORT`; Railway injects it.
- `generated/prisma/` is gitignored and regenerated during build — do not commit it.
- Add `uploads/` to a Railway Volume OR move to object storage before relying on uploads in prod.
- `FIREBASE_PRIVATE_KEY` must preserve `\n` sequences when pasted into Railway's env UI.
- Tighten CORS `origin` from `true` to an allowlist before going public.

## Known rough edges

- `@nestjs/serve-static` installed but not registered — uploads aren't actually served (see above).
- `src/utils/email/` is empty — no email delivery exists.
- Several `GET` endpoints return unbounded lists (products, orders, coupons). Add pagination when touching them.
- `MAX_FILE_SIZE` in `src/utils/multer/multer.ts` is 10 MB; a comment incorrectly says 5 MB.
- Possible duplicate `@Get()` routes in `category.controller.ts` and `brand.controller.ts` — verify before adding more.
- JWT fallback secret `'defaultSecret'` exists for boot resilience; treat as a bug in prod.
- `Decimal` columns in Prisma (prices, totals) are passed around as JS `number` in DTOs — large-amount precision loss is possible.

## When in doubt

- Mirror the closest existing module (e.g., for a CRUD + image upload module, copy the shape of `src/brand/`).
- Read `src/app.module.ts` to understand what's globally wired.
- Read `src/main.ts` to understand the response envelope and validation rules before designing a new endpoint's contract.
