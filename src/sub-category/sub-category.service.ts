import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { FindAdminSubCategoriesDto } from './dto/find-admin-sub-categories.dto';

const ADMIN_PARENT_CATEGORY_SELECT = {
  select: { id: true, name: true, is_hidden: true },
} as const;

@Injectable()
export class SubCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  create(createSubCategoryDto: CreateSubCategoryDto, imageUrl?: string) {
    return this.prisma.subCategory.create({
      data: {
        ...createSubCategoryDto,
        image: imageUrl,
      },
    });
  }
  //flutter
  findAll() {
    return this.prisma.subCategory.findMany({
      where: { is_hidden: false },
      orderBy: { display_order: 'asc' },
    });
  }

  /** Admin list: hidden included, with the parent category for context. */
  findAllforAdmin(query: FindAdminSubCategoriesDto = {}) {
    const { category_id } = query;

    return this.prisma.subCategory.findMany({
      where: { category_id },
      orderBy: { display_order: 'asc' },
      include: { category: ADMIN_PARENT_CATEGORY_SELECT },
    });
  }

  /** Admin edit form: hidden included, with parent category and linked brands. */
  async findOneForAdmin(id: number) {
    const subCategory = await this.prisma.subCategory.findUnique({
      where: { id },
      include: {
        category: ADMIN_PARENT_CATEGORY_SELECT,
        brandSubCategories: {
          where: { brand: { deleted_at: null } },
          include: {
            brand: { select: { id: true, name: true, logo: true } },
          },
        },
      },
    });

    if (!subCategory) {
      throw new NotFoundException('Sub category not found');
    }

    const { brandSubCategories, ...rest } = subCategory;

    return {
      ...rest,
      brands: brandSubCategories.map((link) => link.brand),
    };
  }
  // get subcategory with brands  flutter
  async findOne(id: number) {
    // Hidden subcategories, and those under a hidden category, are not public.
    const subCategory = await this.prisma.subCategory.findFirst({
      where: { id, is_hidden: false, category: { is_hidden: false } },
      include: {
        brandSubCategories: {
          where: {
            brand: {
              deleted_at: null,
            },
          },
          include: {
            brand: {
              select: {
                id: true,
                name: true,
                logo: true,
              },
            },
          },
        },
      },
    });

    if (!subCategory) {
      throw new NotFoundException('Sub category not found');
    }

    return subCategory;
  }

  async update(
    id: number,
    updateSubCategoryDto: UpdateSubCategoryDto,
    imageUrl?: string,
  ) {
    const subCategory = await this.prisma.subCategory.findUnique({
      where: { id },
    });

    if (!subCategory) {
      if (imageUrl) await this.deleteLocalFiles([imageUrl]);
      throw new NotFoundException('Sub category not found');
    }

    const updated = await this.prisma.subCategory.update({
      where: { id },
      data: {
        ...updateSubCategoryDto,
        ...(imageUrl && { image: imageUrl }),
      },
    });

    if (imageUrl && subCategory.image) {
      await this.deleteLocalFiles([subCategory.image]);
    }

    return updated;
  }

  remove(id: number) {
    return this.prisma.subCategory.update({
      where: { id },
      data: { is_hidden: true },
    });
  }

  private async deleteLocalFiles(publicPaths: string[]): Promise<void> {
    await Promise.all(
      publicPaths.map(async (p) => {
        try {
          await fs.unlink(join(process.cwd(), p));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return;
          }
          throw error;
        }
      }),
    );
  }
}
