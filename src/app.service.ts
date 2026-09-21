import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from './prisma/prisma.service';

const homeProductInclude = {
  images: { orderBy: { display_order: 'asc' } },
  subCategory: { select: { id: true, name: true } },
  brand: { select: { id: true, name: true, logo: true } },
} satisfies Prisma.ProductInclude;

type HomeProduct = Prisma.ProductGetPayload<{
  include: typeof homeProductInclude;
}>;

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}



  async getHome(userId: number) {
    const visibleProduct = {
      is_available: true,
      subCategory: { is_hidden: false },
    } satisfies Prisma.ProductWhereInput;

    const [
      banners,
      offers,
      bestSellers,
      suggested,
      categories,
      brands,
      reordered,
    ] = await Promise.all([
      this.prisma.banner.findMany({
        where: { is_active: true },
        orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
        include: {
          images: { orderBy: { sort_order: 'asc' } },
        },
      }),
      this.prisma.product.findMany({
        where: { ...visibleProduct, discount_price: { not: null } },
        orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
        take: 10,
        include: homeProductInclude,
      }),
      this.prisma.product.findMany({
        where: { ...visibleProduct, is_best_seller: true },
        orderBy: [{ review_count: 'desc' }, { display_order: 'asc' }],
        take: 10,
        include: homeProductInclude,
      }),
      this.prisma.product.findMany({
        where: { ...visibleProduct, is_new: true },
        orderBy: [{ display_order: 'asc' }, { created_at: 'desc' }],
        take: 10,
        include: homeProductInclude,
      }),
      this.prisma.category.findMany({
        where: { is_hidden: false },
        orderBy: { display_order: 'asc' },
      }),
      this.prisma.brand.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          name: true,
          logo: true,
          created_at: true,
          updated_at: true,
        },
      }),
      this.getReorderedProducts(userId),
    ]);

    return {
      banners,
      offers: offers.map((product) => this.toHomeProduct(product)),
      best_sellers: bestSellers.map((product) => this.toHomeProduct(product)),
      suggested: suggested.map((product) => this.toHomeProduct(product)),
      categories,
      reordered: reordered.map((product) => this.toHomeProduct(product)),
      brands,
    };
  }

  private async getReorderedProducts(userId: number): Promise<HomeProduct[]> {
    const orderItems = await this.prisma.orderItem.findMany({
      where: {
        order: {
          user_id: userId,
          status: {
            notIn: [OrderStatus.CANCELLED, OrderStatus.CLIENTCANCELLED],
          },
        },
        product: {
          is_available: true,
          subCategory: { is_hidden: false },
        },
      },
      orderBy: { id: 'desc' },
      distinct: ['product_id'],
      take: 10,
      include: {
        product: { include: homeProductInclude },
      },
    });

    return orderItems.map((item) => item.product);
  }

  private toHomeProduct(product: HomeProduct) {
    return {
      id: product.id,
      name: product.name,
      image: product.image,
      images: product.images.map((image) => image.image_url),
      price: Math.round(Number(product.price)),
     discount_price:
  product.discount_price === null
    ? null
    : Math.round(Number(product.discount_price)),
      discount_percentage:
        product.discount_percentage === null
          ? null
          : Number(product.discount_percentage),
      unit: product.unit,
      is_available: product.is_available,
      rating: Number(product.rating),
      review_count: product.review_count,
      subcategory_id: product.subcategory_id,
      subcategory_name: product.subCategory?.name,
      brand: product.brand,
      is_best_seller: product.is_best_seller,
      is_new: product.is_new,
    };
  }
}
