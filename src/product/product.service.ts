import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FindAllProductsDto } from './dto/find-all-products.dto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    createProductDto: CreateProductDto,
    mainImageUrl: string,
    galleryImageUrls: string[],
  ) {
    let discount_percentage: number | null = null;
    if (createProductDto.discount_price && createProductDto.price > 0) {
      discount_percentage = Math.round(
        ((createProductDto.price - createProductDto.discount_price) / createProductDto.price) * 100
      );
    }

    try {
      return await this.prisma.product.create({
        data: {
          ...createProductDto,
          discount_percentage,
          image: mainImageUrl,
          images: {
            create: galleryImageUrls.map((url, index) => ({
              image_url: url,
              display_order: index,
            })),
          },
        },
        include: { images: true },
      });
    } catch (error) {
      // DB write failed — delete every file that was already written to disk
      await this.deleteLocalFiles([mainImageUrl, ...galleryImageUrls]);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('Category or brand does not exist');
      }
      throw error;
    }
  }

  async update(
    id: number,
    updateProductDto: UpdateProductDto,
    mainImageUrl?: string,
  ) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { image: true, price: true, discount_price: true },
    });

    if (!product) {
      if (mainImageUrl) await this.deleteLocalFiles([mainImageUrl]);
      throw new NotFoundException('Product not found');
    }

    const newPrice = updateProductDto.price !== undefined ? updateProductDto.price : Number(product.price);
    const newDiscountPrice = updateProductDto.discount_price !== undefined 
      ? updateProductDto.discount_price 
      : (product.discount_price ? Number(product.discount_price) : null);

    let discount_percentage: number | null = null;
    if (newDiscountPrice && newPrice > 0) {
      discount_percentage = Math.round(
        ((newPrice - newDiscountPrice) / newPrice) * 100
      );
    }

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: {
          ...updateProductDto,
          discount_percentage,
          ...(mainImageUrl && { image: mainImageUrl }),
        },
        include: { images: true },
      });

      // Update successful — delete the old main image if replaced
      if (mainImageUrl && product.image) {
        await this.deleteLocalFiles([product.image]);
      }

      return updated;
    } catch (error) {
      if (mainImageUrl) await this.deleteLocalFiles([mainImageUrl]);

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new BadRequestException('Category or brand does not exist');
      }
      throw error;
    }
  }

  // --- Gallery Image Management ---

 async addGalleryImages(productId: number, galleryImageUrls: string[]) {
  const product = await this.prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });

  if (!product) {
    await this.deleteLocalFiles(galleryImageUrls);
    throw new NotFoundException('Product not found');
  }

  try {
    const lastImage = await this.prisma.productImage.findFirst({
      where: { product_id: productId },
      orderBy: { display_order: 'desc' },
    });
    const startOrder = lastImage ? lastImage.display_order + 1 : 0;

    await this.prisma.productImage.createMany({
      data: galleryImageUrls.map((url, index) => ({
        product_id: productId,
        image_url: url,
        display_order: startOrder + index,
      })),
    });
  } catch (error) {
    // بنمسح الملفات هنا بس، لأن الـ catch ده بيغلف الـ DB write الفعلي بس
    await this.deleteLocalFiles(galleryImageUrls);
    throw error;
  }

  // لو وصلنا هنا، الـ createMany نجحت فعلاً — الـ findOne برّه أي احتمال تنضيف غلط
  return this.findOne(productId);
}

  async removeGalleryImage(productId: number, imageId: number) {
    const image = await this.prisma.productImage.findFirst({
      where: {
        id: imageId,
        product_id: productId,
      },
    });

    if (!image) {
      throw new NotFoundException('Product image not found');
    }

    await this.prisma.productImage.delete({
      where: { id: imageId },
    });

    await this.deleteLocalFiles([image.image_url]);

    return { success: true };
  }

  // --- End Gallery Image Management ---

  async remove(id: number) {
    const product = await this.prisma.product.findUnique({ where: { id } });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.prisma.product.update({
      where: { id },
      data: { is_available: false },
    });
  }

  /**
   * Deletes local files by their public URL paths (e.g. /uploads/products/xxx.jpg).
   * Errors are silently swallowed — a missing file should never crash a request.
   */
  private async deleteLocalFiles(publicPaths: string[]): Promise<void> {
    await Promise.all(
      publicPaths.map((p) => fs.unlink(join(process.cwd(), p)).catch(() => {})),
    );
  }

  async findAll(query: FindAllProductsDto) {
    const {
      category_id,
      search,
      available,
      offers,
      min_rating,
      brand_id,
      sort,
      page = 1,
      per_page = 20,
    } = query;

    const where: Prisma.ProductWhereInput = {};

    if (category_id) where.category_id = category_id;
    if (brand_id) where.brand_id = brand_id;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (available === 1) where.is_available = true;
    if (offers === 1) where.discount_price = { not: null };
    
    if (min_rating !== undefined) {
      where.rating = { gte: min_rating };
    }

    let orderBy: any = { display_order: 'asc' };
    switch (sort) {
      case 'bestSelling':
        orderBy = [{ is_best_seller: 'desc' }, { review_count: 'desc' }];
        break;
      case 'newest':
        orderBy = [{ is_new: 'desc' }, { id: 'desc' }];
        break;
      case 'topRated':
        orderBy = { rating: 'desc' };
        break;
      case 'nameAsc':
        orderBy = { name: 'asc' };
        break;
      default:
        orderBy = { display_order: 'asc' };
    }

    const skip = (page - 1) * per_page;

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: per_page,
        include: {
          images: true,
          category: { select: { name: true } },
          brand: true,
        },
      }),
    ]);

    const last_page = Math.ceil(total / per_page) || 1;
    const next_page = page < last_page ? page + 1 : null;

    let items = products.map((product) => ({
      id: product.id,
      name: product.name,
      image: product.image,
      images: product.images.map((img) => img.image_url),
      price: Number(product.price),
      discount_price: product.discount_price ? Number(product.discount_price) : null,
      discount_percentage: product.discount_percentage ? Number(product.discount_percentage) : null,
      unit: product.unit,
      is_available: product.is_available,
      rating: Number(product.rating),
      review_count: product.review_count,
      category_id: product.category_id,
      category_name: product.category?.name,
      brand: product.brand,
      is_best_seller: product.is_best_seller,
      is_new: product.is_new,
    }));

    // If offers filter is requested, ensure discount_price < price (effective offers only)
    if (offers === 1) {
      items = items.filter((p) => p.discount_price !== null && p.discount_price < p.price);
    }

    return {
      items,
      page,
      next_page,
      last_page,
      total,
    };
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        images: true,
        category: { select: { name: true } },
        brand: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      id: product.id,
      name: product.name,
      image: product.image,
      images: product.images.map((img) => img.image_url),
      price: Number(product.price),
      discount_price: product.discount_price ? Number(product.discount_price) : null,
      discount_percentage: product.discount_percentage ? Number(product.discount_percentage) : null,
      unit: product.unit,
      is_available: product.is_available,
      rating: Number(product.rating),
      review_count: product.review_count,
      category_id: product.category_id,
      category_name: product.category?.name,
      brand: product.brand,
      is_best_seller: product.is_best_seller,
      is_new: product.is_new,
    };
  }

  async search(q: string) {
    const products = await this.prisma.product.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { brand: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      include: {
        images: true,
        category: { select: { name: true } },
        brand: true,
      },
      take: 20,
    });

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      image: product.image,
      images: product.images.map((img) => img.image_url),
      price: Number(product.price),
      discount_price: product.discount_price ? Number(product.discount_price) : null,
      discount_percentage: product.discount_percentage ? Number(product.discount_percentage) : null,
      unit: product.unit,
      is_available: product.is_available,
      rating: Number(product.rating),
      review_count: product.review_count,
      category_id: product.category_id,
      category_name: product.category?.name,
      brand: product.brand,
      is_best_seller: product.is_best_seller,
      is_new: product.is_new,
    }));
  }

  async getReviews(id: number) {
    const reviews = await this.prisma.review.findMany({
      where: { product_id: id },
      orderBy: { created_at: 'desc' },
    });

    return reviews.map((review) => ({
      id: review.id,
      author_name: review.author_name,
      rating: review.rating,
      comment: review.comment,
      created_at: review.created_at,
    }));
  }
}

