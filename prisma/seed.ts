import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
// `.js` suffix omitted intentionally — ts-node in CJS mode resolves to the `.ts` source.
// Real app code (src/prisma/prisma.service.ts) uses `.js` because nest build emits .js.
// This file is only run via ts-node for seeding.
// eslint-disable-next-line
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// -------- bootstrap --------
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const ROOT = resolve(__dirname, '..');
const IMAGES_DIR = join(ROOT, 'images');
const UPLOADS_DIR = join(ROOT, 'uploads');

type UploadFolderKey = 'categories' | 'sub-category' | 'brands' | 'banners';
const writtenUrls: Record<UploadFolderKey, string[]> = {
  categories: [],
  'sub-category': [],
  brands: [],
  banners: [],
};

function copyImageToUploads(
  srcFolderOnDisk: 'category' | 'subcategory' | 'brand' | 'banner',
  srcFilename: string,
  destFolder: UploadFolderKey,
): string {
  const srcPath = join(IMAGES_DIR, srcFolderOnDisk, srcFilename);
  if (!existsSync(srcPath)) {
    throw new Error(`Missing source image: ${srcPath}`);
  }
  const ext = (extname(srcFilename) || '.png').toLowerCase();
  const newName = `${randomUUID()}${ext}`;
  const destDir = join(UPLOADS_DIR, destFolder);
  mkdirSync(destDir, { recursive: true });
  copyFileSync(srcPath, join(destDir, newName));
  const url = `/uploads/${destFolder}/${newName}`;
  writtenUrls[destFolder].push(url);
  return url;
}

function findFileByPrefix(folder: 'category' | 'subcategory' | 'brand' | 'banner', prefixes: string[]): string | null {
  const files = readdirSync(join(IMAGES_DIR, folder));
  for (const p of prefixes) {
    const match = files.find((f) => f.toLowerCase().includes(p.toLowerCase()));
    if (match) return match;
  }
  return null;
}

// -------- helpers --------
function pick<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function rand(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min));
}

function pct(price: number, discount: number): number {
  return Math.round(((price - discount) / price) * 100 * 100) / 100;
}

type OFFHit = { product_name?: string; image_url?: string; quantity?: string };

async function fetchOFF(query: string, want: number): Promise<OFFHit[]> {
  const url = `https://world.openfoodfacts.org/api/v2/search?${query}&fields=product_name,image_url,quantity&page_size=${want * 3}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'taha_supplier-seed/1.0 (local-dev)' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.warn(`  OFF ${res.status} for ${query} — falling back`);
      return [];
    }
    const body: any = await res.json();
    const products: OFFHit[] = Array.isArray(body?.products) ? body.products : [];
    return products
      .filter(
        (p) =>
          typeof p.product_name === 'string' &&
          p.product_name.trim().length > 2 &&
          typeof p.image_url === 'string' &&
          /^https?:\/\//.test(p.image_url),
      )
      .slice(0, want);
  } catch (err: any) {
    console.warn(`  OFF fetch failed for ${query}: ${err?.message ?? err} — falling back`);
    return [];
  }
}

function placeholderPool(seed: string, n: number): OFFHit[] {
  return Array.from({ length: n }, (_, i) => ({
    product_name: `${seed} ${i + 1}`,
    image_url: `https://picsum.photos/seed/${encodeURIComponent(seed)}-${i}/600/600`,
    quantity: '1',
  }));
}

async function sourceProducts(
  key: string,
  offQuery: string,
  fallbackSeed: string,
  want: number,
): Promise<OFFHit[]> {
  const hits = await fetchOFF(offQuery, want);
  if (hits.length >= Math.min(3, want)) {
    if (hits.length < want) {
      return [...hits, ...placeholderPool(fallbackSeed, want - hits.length)];
    }
    return hits;
  }
  console.warn(`  Using fallback placeholders for ${key}`);
  return placeholderPool(fallbackSeed, want);
}

// -------- seed --------
async function main() {
  console.log('→ Preflight');
  const admin = await prisma.user.findUnique({ where: { email: 'taha@gmail.com' } });
  if (!admin) {
    throw new Error('Admin user taha@gmail.com not found — stopping.');
  }
  console.log(`  admin ok (id=${admin.id}, role=${admin.role})`);

  // ---------- Categories ----------
  console.log('→ Categories');
  const catSpec: Array<{ name: string; imageFile: string; order: number }> = [
    { name: 'المواد الخام', imageFile: 'المواد_الخام.png', order: 0 },
    { name: 'المطبخ', imageFile: 'المطبخ .png', order: 1 },
    { name: 'الكوبايات الورق', imageFile: 'الكوبايات .png', order: 2 },
  ];

  const categories: Record<string, { id: number; image: string | null }> = {};
  for (const c of catSpec) {
    const existing = await prisma.category.findFirst({ where: { name: c.name } });
    if (existing) {
      categories[c.name] = { id: existing.id, image: existing.image };
      console.log(`  [=] ${c.name} (id=${existing.id})`);
    } else {
      const url = copyImageToUploads('category', c.imageFile, 'categories');
      const created = await prisma.category.create({
        data: { name: c.name, image: url, display_order: c.order, is_hidden: false },
      });
      categories[c.name] = { id: created.id, image: url };
      console.log(`  [+] ${c.name} (id=${created.id})`);
    }
  }

  // ---------- SubCategories under "المواد الخام" ----------
  console.log('→ SubCategories');
  const rawParentId = categories['المواد الخام'].id;
  const subSpec: Array<{ name: string; imageFile: string; order: number }> = [
    { name: 'قهوة', imageFile: 'coffebeansimages.jpeg', order: 0 },
    { name: 'دقيق', imageFile: 'flour.jpeg', order: 1 },
    { name: 'صوص', imageFile: 'sauces.jpg', order: 2 },
  ];

  const subs: Record<string, { id: number; image: string | null }> = {};
  for (const s of subSpec) {
    const existing = await prisma.subCategory.findFirst({
      where: { name: s.name, category_id: rawParentId },
    });
    if (existing) {
      subs[s.name] = { id: existing.id, image: existing.image };
      console.log(`  [=] ${s.name} (id=${existing.id})`);
    } else {
      const url = copyImageToUploads('subcategory', s.imageFile, 'sub-category');
      const created = await prisma.subCategory.create({
        data: {
          name: s.name,
          category_id: rawParentId,
          image: url,
          display_order: s.order,
          is_hidden: false,
        },
      });
      subs[s.name] = { id: created.id, image: url };
      console.log(`  [+] ${s.name} (id=${created.id})`);
    }
  }

  // ---------- Brands ----------
  console.log('→ Brands');
  const brandSpec: Array<{ name: string; imageFile: string }> = [
    { name: 'دي بيكر (Debic)', imageFile: 'drbakerlogoimages.png' },
    { name: 'لافازا (Lavazza)', imageFile: 'Lavazza-Logo.png' },
    { name: 'نسكافيه (Nescafé)', imageFile: '508_nescafe.jpg' },
  ];

  const brands: Record<string, { id: number; logo: string }> = {};
  for (const b of brandSpec) {
    const existing = await prisma.brand.findUnique({ where: { name: b.name } });
    if (existing) {
      brands[b.name] = { id: existing.id, logo: existing.logo };
      console.log(`  [=] ${b.name} (id=${existing.id})`);
    } else {
      const url = copyImageToUploads('brand', b.imageFile, 'brands');
      const created = await prisma.brand.create({
        data: { name: b.name, logo: url },
      });
      brands[b.name] = { id: created.id, logo: url };
      console.log(`  [+] ${b.name} (id=${created.id})`);
    }
  }

  // ---------- Brand ↔ SubCategory links ----------
  console.log('→ BrandSubCategory links');
  const links: Array<[string, string]> = [
    ['لافازا (Lavazza)', 'قهوة'],
    ['نسكافيه (Nescafé)', 'قهوة'],
    ['دي بيكر (Debic)', 'دقيق'],
    ['دي بيكر (Debic)', 'صوص'],
  ];
  for (const [brandName, subName] of links) {
    const brand_id = brands[brandName].id;
    const subcategory_id = subs[subName].id;
    const existing = await prisma.brandSubCategory.findUnique({
      where: { brand_id_subcategory_id: { brand_id, subcategory_id } },
    });
    if (existing) {
      console.log(`  [=] ${brandName} ↔ ${subName}`);
    } else {
      await prisma.brandSubCategory.create({ data: { brand_id, subcategory_id } });
      console.log(`  [+] ${brandName} ↔ ${subName}`);
    }
  }

  // ---------- Products ----------
  console.log('→ Products (fetching real names + images)');

  const lavazzaHits = await sourceProducts('lavazza', 'brands=lavazza', 'coffee-lavazza', 5);
  const nescafeHits = await sourceProducts('nescafe', 'brands=nescafe', 'coffee-nescafe', 5);
  const flourHits = await sourceProducts('flour', 'categories=flours', 'flour', 10);
  const sauceHits = await sourceProducts('sauce', 'categories=sauces', 'sauce', 10);

  console.log(`  OFF: lavazza=${lavazzaHits.length} nescafe=${nescafeHits.length} flour=${flourHits.length} sauce=${sauceHits.length}`);

  const descByCat: Record<string, string> = {
    'قهوة': 'قهوة فاخرة بنكهة غنية ومذاق مميز، مناسبة للاستخدام اليومي والمحترفين.',
    'دقيق': 'دقيق عالي الجودة مطحون بعناية، مناسب للخبز والمعجنات والاستخدامات اليومية.',
    'صوص': 'صوص جاهز للاستخدام بطعم شهي ومكونات مختارة، لإضافة لمسة احترافية لأطباقك.',
  };
  const unitByCat: Record<string, string> = {
    'قهوة': 'كجم',
    'دقيق': 'كجم',
    'صوص': 'لتر',
  };
  const priceRange: Record<string, [number, number]> = {
    'قهوة': [180, 850],
    'دقيق': [40, 220],
    'صوص': [45, 300],
  };

  type ProductPlan = {
    hits: OFFHit[];
    sub: string;
    brand: string;
  };
  const plans: ProductPlan[] = [
    { hits: lavazzaHits, sub: 'قهوة', brand: 'لافازا (Lavazza)' },
    { hits: nescafeHits, sub: 'قهوة', brand: 'نسكافيه (Nescafé)' },
    { hits: flourHits, sub: 'دقيق', brand: 'دي بيكر (Debic)' },
    { hits: sauceHits, sub: 'صوص', brand: 'دي بيكر (Debic)' },
  ];

  let createdProducts = 0;
  let skippedProducts = 0;
  const sampleProductIds: number[] = [];
  let flagIdx = 0; // cycles best_seller / is_new / discount

  for (const plan of plans) {
    const subcategory_id = subs[plan.sub].id;
    const brand_id = brands[plan.brand].id;
    const [pMin, pMax] = priceRange[plan.sub];

    for (let i = 0; i < plan.hits.length; i++) {
      const hit = plan.hits[i];
      const rawName = (hit.product_name ?? '').trim();
      const qtySuffix = hit.quantity ? ` - ${hit.quantity}` : '';
      const name = (rawName + qtySuffix).slice(0, 120) || `منتج ${plan.brand} ${i + 1}`;

      const existing = await prisma.product.findFirst({
        where: { name, subcategory_id, brand_id },
      });
      if (existing) {
        skippedProducts++;
        if (sampleProductIds.length < 1) sampleProductIds.push(existing.id);
        continue;
      }

      const price = rand(pMin, pMax);
      // cycle: 0,1 → discount; 2,3 → best_seller; 4 → new; then repeat
      const isDiscount = flagIdx % 5 < 2;
      const isBest = flagIdx % 5 === 2 || flagIdx % 5 === 3;
      const isNew = flagIdx % 5 === 4;
      flagIdx++;

      const discount_price = isDiscount ? Math.max(1, Math.round(price * (0.7 + Math.random() * 0.15))) : null;
      const discount_percentage = discount_price ? pct(price, discount_price) : null;
      const review_count = isBest ? rand(40, 220) : rand(0, 15);
      const rating = isBest ? Number((3.8 + Math.random() * 1.1).toFixed(2)) : Number((3 + Math.random() * 2).toFixed(2));

      const mainImage =
        hit.image_url && /^https?:\/\//.test(hit.image_url)
          ? hit.image_url
          : `https://picsum.photos/seed/${encodeURIComponent(plan.sub + '-' + i)}/600/600`;

      const created = await prisma.product.create({
        data: {
          subcategory_id,
          brand_id,
          name,
          description: descByCat[plan.sub],
          image: mainImage,
          price,
          discount_price: discount_price ?? undefined,
          discount_percentage: discount_percentage ?? undefined,
          rating,
          review_count,
          is_best_seller: isBest,
          is_new: isNew,
          unit: unitByCat[plan.sub],
          is_available: true,
          display_order: i,
          images: {
            create: [
              { image_url: mainImage, display_order: 0 },
            ],
          },
        },
      });
      createdProducts++;
      if (sampleProductIds.length < 1) sampleProductIds.push(created.id);
    }
  }
  console.log(`  products: +${createdProducts} created, ${skippedProducts} already existed`);

  // ---------- Coupons ----------
  console.log('→ Coupons');
  const now = new Date();
  const inAMonth = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  const twoMonthsOut = new Date(now.getTime() + 60 * 24 * 3600 * 1000);
  const aWeekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

  const couponSpec = [
    {
      code: 'WELCOME10',
      discount_value: 10,
      min_order_amount: null as number | null,
      start_date: monthAgo,
      end_date: twoMonthsOut,
      usage_limit: 100,
      status: 'ACTIVE' as const,
    },
    {
      code: 'SUMMER20',
      discount_value: 20,
      min_order_amount: 500,
      start_date: now,
      end_date: inAMonth,
      usage_limit: 50,
      status: 'ACTIVE' as const,
    },
    {
      code: 'EXPIRED15',
      discount_value: 15,
      min_order_amount: 300,
      start_date: monthAgo,
      end_date: aWeekAgo, // past → expired via date, status still ACTIVE
      usage_limit: 20,
      status: 'ACTIVE' as const,
    },
  ];

  for (const c of couponSpec) {
    const existing = await prisma.coupon.findUnique({ where: { code: c.code } });
    if (existing) {
      console.log(`  [=] ${c.code} (id=${existing.id})`);
    } else {
      const created = await prisma.coupon.create({
        data: {
          code: c.code,
          discount_value: c.discount_value,
          min_order_amount: c.min_order_amount ?? undefined,
          start_date: c.start_date,
          end_date: c.end_date,
          usage_limit: c.usage_limit,
          status: c.status,
        },
      });
      console.log(`  [+] ${c.code} (id=${created.id})`);
    }
  }

  // ---------- Shipping zones ----------
  console.log('→ Shipping zones');
  const zoneSpec = [
    { name: 'القاهرة', shipping_cost: 30, display_order: 0 },
    { name: 'المنصورة', shipping_cost: 50, display_order: 1 },
    { name: 'أسوان', shipping_cost: 200, display_order: 2 },
    { name: 'أخرى', shipping_cost: 100, display_order: 3 },
  ];
  for (const z of zoneSpec) {
    const existing = await prisma.shippingZone.findUnique({ where: { name: z.name } });
    if (existing) {
      console.log(`  [=] ${z.name} (id=${existing.id}, ${existing.shipping_cost} EGP)`);
    } else {
      const created = await prisma.shippingZone.create({
        data: {
          name: z.name,
          shipping_cost: z.shipping_cost,
          is_active: true,
          display_order: z.display_order,
        },
      });
      console.log(`  [+] ${z.name} (id=${created.id}, ${z.shipping_cost} EGP)`);
    }
  }

  // ---------- Banner ----------
  console.log('→ Banners');
  const bannerFiles = readdirSync(join(IMAGES_DIR, 'banner'));
  if (bannerFiles.length === 0) {
    console.log('  no files in images/banner/, skipping');
  } else {
    const bannerTitle = 'عروض اليوم';
    const existingBanner = await prisma.banner.findFirst({ where: { title: bannerTitle } });
    if (existingBanner) {
      console.log(`  [=] "${bannerTitle}" (id=${existingBanner.id})`);
    } else {
      const targetCategoryId = categories['المواد الخام'].id;
      const images = bannerFiles.map((filename, idx) => {
        const url = copyImageToUploads('banner', filename, 'banners');
        return {
          image_url: url,
          sort_order: idx,
          click_action_type: 'CATEGORY' as const,
          click_target_id: targetCategoryId,
        };
      });
      const created = await prisma.banner.create({
        data: {
          title: bannerTitle,
          is_active: true,
          sort_order: 0,
          images: { create: images },
        },
        include: { images: true },
      });
      console.log(`  [+] "${bannerTitle}" (id=${created.id}, images=${created.images.length})`);
    }
  }

  // ---------- Verification ----------
  console.log('\n==== Row counts ====');
  const counts = {
    categories: await prisma.category.count(),
    subcategories: await prisma.subCategory.count(),
    brands: await prisma.brand.count(),
    brandSubCategories: await prisma.brandSubCategory.count(),
    products: await prisma.product.count(),
    productImages: await prisma.productImage.count(),
    coupons: await prisma.coupon.count(),
    shippingZones: await prisma.shippingZone.count(),
    banners: await prisma.banner.count(),
    bannerImages: await prisma.bannerImage.count(),
  };
  for (const [k, v] of Object.entries(counts)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log('\n==== Sample product (populated) ====');
  if (sampleProductIds.length > 0) {
    const sample = await prisma.product.findUnique({
      where: { id: sampleProductIds[0] },
      include: {
        subCategory: { include: { category: true } },
        brand: true,
        images: true,
      },
    });
    console.log(JSON.stringify(sample, null, 2));
  }

  // ---------- /home equivalent query (mirrors doc/home.flutter.txt) ----------
  console.log('\n==== GET /home equivalent (Prisma mirror) ====');
  const [banners, offers, best_sellers, suggested, homeCategories, homeBrands] = await Promise.all([
    prisma.banner.findMany({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
      include: { images: { orderBy: { sort_order: 'asc' } } },
    }),
    prisma.product.findMany({
      where: {
        is_available: true,
        discount_price: { not: null },
        subCategory: { is_hidden: false },
      },
      orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
      take: 10,
      include: { brand: true, subCategory: true, images: true },
    }),
    prisma.product.findMany({
      where: {
        is_available: true,
        is_best_seller: true,
        subCategory: { is_hidden: false },
      },
      orderBy: [{ review_count: 'desc' }, { display_order: 'asc' }],
      take: 10,
      include: { brand: true, subCategory: true, images: true },
    }),
    prisma.product.findMany({
      where: {
        is_available: true,
        is_new: true,
        subCategory: { is_hidden: false },
      },
      orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
      take: 10,
      include: { brand: true, subCategory: true, images: true },
    }),
    prisma.category.findMany({
      where: { is_hidden: false },
      orderBy: { display_order: 'asc' },
    }),
    prisma.brand.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
    }),
  ]);

  const toProductItem = (p: any) => ({
    id: p.id,
    name: p.name,
    image: p.image,
    images: p.images.map((i: any) => i.image_url),
    price: Number(p.price),
    discount_price: p.discount_price !== null ? Number(p.discount_price) : null,
    discount_percentage: p.discount_percentage !== null ? Number(p.discount_percentage) : null,
    unit: p.unit,
    is_available: p.is_available,
    rating: Number(p.rating),
    review_count: p.review_count,
    subcategory_id: p.subcategory_id,
    subcategory_name: p.subCategory?.name,
    brand: p.brand ? { id: p.brand.id, name: p.brand.name, logo: p.brand.logo } : null,
    is_best_seller: p.is_best_seller,
    is_new: p.is_new,
  });

  const homePayload = {
    banners,
    offers: offers.map(toProductItem),
    best_sellers: best_sellers.map(toProductItem),
    suggested: suggested.map(toProductItem),
    categories: homeCategories,
    reordered: [], // no CLIENT user context — same empty array /home would return
    brands: homeBrands,
  };

  console.log(JSON.stringify(homePayload, null, 2));

  // ---------- Final: list every /uploads/... URL we wrote to the DB ----------
  console.log('\n==== /uploads/... URLs written to the DB ====');
  console.log('(the backend does NOT currently register serve-static, so these paths will 404 if hit directly)');
  const dbCategoryImages = (await prisma.category.findMany({ select: { name: true, image: true } }))
    .filter((c) => c.image && c.image.startsWith('/uploads/'));
  const dbSubImages = (await prisma.subCategory.findMany({ select: { name: true, image: true } }))
    .filter((s) => s.image && s.image.startsWith('/uploads/'));
  const dbBrandLogos = (await prisma.brand.findMany({ select: { name: true, logo: true } }))
    .filter((b) => b.logo && b.logo.startsWith('/uploads/'));
  const dbBannerImgs = (await prisma.bannerImage.findMany({ select: { image_url: true, banner_id: true } }))
    .filter((i) => i.image_url.startsWith('/uploads/'));

  console.log(`\n  categories (${dbCategoryImages.length}):`);
  dbCategoryImages.forEach((c) => console.log(`    ${c.image}   ← ${c.name}`));
  console.log(`\n  sub-category (${dbSubImages.length}):`);
  dbSubImages.forEach((s) => console.log(`    ${s.image}   ← ${s.name}`));
  console.log(`\n  brands (${dbBrandLogos.length}):`);
  dbBrandLogos.forEach((b) => console.log(`    ${b.logo}   ← ${b.name}`));
  console.log(`\n  banners (${dbBannerImgs.length}):`);
  dbBannerImgs.forEach((i) => console.log(`    ${i.image_url}   ← banner_id=${i.banner_id}`));

  console.log('\n✓ Done.');
}

main()
  .catch((e) => {
    console.error('\n✗ Seed failed:');
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
