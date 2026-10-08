import { Injectable, NotFoundException } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  create(createCategoryDto: CreateCategoryDto, imageUrl?: string) {
    return this.prisma.category.create({
      data: {
        ...createCategoryDto,
        image: imageUrl,
      },
    });
  }

  findAll() {
    return this.prisma.category.findMany({
      where: { is_hidden: false },
      orderBy: { display_order: 'asc' },
    });
  }

  async findAllforAdmin() {
    return await this.prisma.category.findMany({
      include: { subcategories: true },
      orderBy: { display_order: 'asc' },
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.category.findFirst({
      where: { id, is_hidden: false },
      include: { subcategories: { where: { is_hidden: false } } },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async update(
    id: number,
    updateCategoryDto: UpdateCategoryDto,
    imageUrl?: string,
  ) {
    const category = await this.prisma.category.findUnique({ where: { id } });

    if (!category) {
      if (imageUrl) await this.deleteLocalFiles([imageUrl]);
      throw new NotFoundException('Category not found');
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        ...updateCategoryDto,
        ...(imageUrl && { image: imageUrl }),
      },
    });

    if (imageUrl && category.image) {
      await this.deleteLocalFiles([category.image]);
    }

    return updated;
  }

  remove(id: number) {
    return this.prisma.category.update({
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
