import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { ProductStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
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
    try {
      return await this.prisma.product.create({
        data: {
          ...createProductDto,
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
      select: { image: true },
    });

    if (!product) {
      if (mainImageUrl) await this.deleteLocalFiles([mainImageUrl]);
      throw new NotFoundException('Product not found');
    }

    try {
      const updated = await this.prisma.product.update({
        where: { id },
        data: {
          ...updateProductDto,
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
      data: { status: ProductStatus.UNAVAILABLE },
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

  findAll() {
    return this.prisma.product.findMany({
      include: { images: true },
      orderBy: { display_order: 'asc' },
    });
  }

  async findOne(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { images: true },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return product;
  }
}

