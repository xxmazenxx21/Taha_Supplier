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
        ((createProductDto.price - createProductDto.discount_price) /
          createProductDto.price) *
          100,
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
        throw new BadRequestException('Subcategory or brand does not exist');
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

    const newPrice =
      updateProductDto.price !== undefined
        ? updateProductDto.price
        : Number(product.price);
    const newDiscountPrice =
      updateProductDto.discount_price !== undefined
        ? updateProductDto.discount_price
        : product.discount_price
          ? Number(product.discount_price)
          : null;

    // Guard: merged discount_price must always be strictly less than merged price.
    // This catches the two PATCH-only edge cases the DTO decorator cannot see:
    //   1. { discount_price: X } alone — price comes from the existing row.
    //   2. { price: X } alone        — discount_price comes from the existing row.
    if (newDiscountPrice !== null && newDiscountPrice >= newPrice) {
      if (mainImageUrl) await this.deleteLocalFiles([mainImageUrl]);
      throw new BadRequestException(
        'discount_price cannot be greater than or equal to price',
      );
    }

    let discount_percentage: number | null = null;
    if (newDiscountPrice && newPrice > 0) {
      discount_percentage = Math.round(
        ((newPrice - newDiscountPrice) / newPrice) * 100,
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
        throw new BadRequestException('Subcategory or brand does not exist');
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
      await this.deleteLocalFiles(galleryImageUrls);
      throw error;
    }

    return this.findOne(productId);
  }

  async removeGalleryImage(productId: number, imageId: number) {
    const image = await this.prisma.productImage.findFirst({
      where: { id: imageId, product_id: productId },
    });

    if (!image) {
      throw new NotFoundException('Product image not found');
    }

    await this.prisma.productImage.delete({ where: { id: imageId } });
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

  async findAllAdmin() {
    return await this.prisma.product.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        images: true,

        subCategory: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true, logo: true } },
      },
    });
  }

  async findAll(query: FindAllProductsDto) {
    const {
      subcategory_id,
      category_id,
      search,
      available,
      offers,
      min_rating,
      brand_id,
      sort,
      page = 1,
      per_page = 10,
    } = query;

    const where: Prisma.ProductWhereInput = {
      // Only show products whose subcategory and parent category are visible.
      // `category_id` is undefined when not supplied, which Prisma ignores.
      subCategory: {
        is_hidden: false,
        category_id,
        category: { is_hidden: false },
      },
    };

    if (subcategory_id) where.subcategory_id = subcategory_id;
    if (brand_id) where.brand_id = brand_id;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { brand: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (available === 1) where.is_available = true;
    if (offers === 1) where.discount_price = { not: null };
    if (min_rating !== undefined) where.rating = { gte: min_rating };

    let orderBy:
      | Prisma.ProductOrderByWithRelationInput
      | Prisma.ProductOrderByWithRelationInput[] = { display_order: 'asc' };

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
          subCategory: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true, logo: true } },
        },
      }),
    ]);

    const last_page = Math.ceil(total / per_page) || 1;
    const next_page = page < last_page ? page + 1 : null;

    const items = products.map((product) => ({
      id: product.id,
      name: product.name,
      image: product.image,
      images: product.images.map((img) => img.image_url),
      price: Number(product.price),
      discount_price: product.discount_price
        ? Number(product.discount_price)
        : null,
      discount_percentage: product.discount_percentage
        ? Number(product.discount_percentage)
        : null,
      unit: product.unit,
      is_available: product.is_available,
      rating: Number(product.rating),
      review_count: product.review_count,
      subcategory_id: product.subcategory_id,
      subcategory_name: product.subCategory?.name,
      brand: product.brand,
      is_best_seller: product.is_best_seller,
      is_new: product.is_new,
    }));

    return {
      items,
      page,
      per_page,
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
        subCategory: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true, logo: true } },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      id: product.id,
      name: product.name,
      description: product.description,
      image: product.image,
      images: product.images.map((img) => img.image_url),
      price: Number(product.price),
      discount_price: product.discount_price
        ? Number(product.discount_price)
        : null,
      discount_percentage: product.discount_percentage
        ? Number(product.discount_percentage)
        : null,
      unit: product.unit,
      is_available: product.is_available,
      rating: Number(product.rating),
      review_count: product.review_count,
      subcategory_id: product.subcategory_id,
      subcategory_name: product.subCategory?.name,
      brand: product.brand,
      is_best_seller: product.is_best_seller,
      is_new: product.is_new,
      display_order: product.display_order,
      created_at: product.created_at,
      updated_at: product.updated_at,
    };
  }

  async search(q: string) {
    const products = await this.prisma.product.findMany({
      where: {
        subCategory: { is_hidden: false },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { brand: { name: { contains: q, mode: 'insensitive' } } },
        ],
      },
      include: {
        images: true,
        subCategory: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true, logo: true } },
      },
      take: 20,
    });

    return products.map((product) => ({
      id: product.id,
      name: product.name,
      image: product.image,
      images: product.images.map((img) => img.image_url),
      price: Number(product.price),
      discount_price: product.discount_price
        ? Number(product.discount_price)
        : null,
      discount_percentage: product.discount_percentage
        ? Number(product.discount_percentage)
        : null,
      unit: product.unit,
      is_available: product.is_available,
      rating: Number(product.rating),
      review_count: product.review_count,
      subcategory_id: product.subcategory_id,
      subcategory_name: product.subCategory?.name,
      brand: product.brand,
      is_best_seller: product.is_best_seller,
      is_new: product.is_new,
    }));
  }
}
