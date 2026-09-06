import { Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { getUploadDirectory, UploadFolder } from '../utils/multer/upload-paths';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  create(createCategoryDto: CreateCategoryDto & { image: string }) {
    return this.prisma.category.create({
      data: createCategoryDto,
    });
  }

  findAll() {
    return `This action returns all category`;
  }

  findOne(id: number) {
    return `This action returns a #${id} category`;
  }

  async update(
    id: number,
    updateCategoryDto: UpdateCategoryDto,
    newImagePath?: string,
  ) {
    const category = await this.prisma.category.findUnique({ where: { id } });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const updatedCategory = await this.prisma.category.update({
      where: { id },
      data: {
        ...updateCategoryDto,
        ...(newImagePath && { image: newImagePath }),
      },
    });

    if (newImagePath && category.image !== newImagePath) {
      await this.deleteOldImage(category.image);
    }

    return updatedCategory;
  }

  private async deleteOldImage(imagePath: string | null): Promise<void> {
    const uploadPrefix = `/uploads/${UploadFolder.CATEGORIES}/`;

    // Categories created before image uploads may have no image at all.
    if (!imagePath?.startsWith(uploadPrefix)) {
      return;
    }

    const categoriesDirectory = getUploadDirectory(UploadFolder.CATEGORIES);
    const filePath = resolve(categoriesDirectory, basename(imagePath));

    try {
      await unlink(filePath);
    } catch (error: unknown) {
      // A missing file is harmless. Other failures intentionally stop the request,
      // as requested, even though the database update has already succeeded.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }

      throw error;
    }
  }

  remove(id: number) {
    return this.prisma.category.update({
      where: { id },
      data: { is_hidden: true },
    });
  }
}
