import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto, imageUrl?: string) {
    const { parent_id } = createCategoryDto as any;

    if (parent_id !== undefined && parent_id !== null) {
      const parent = await this.prisma.category.findUnique({ where: { id: parent_id } });
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
      if (parent.parent_id !== null) {
        throw new BadRequestException('Cannot create a child under a child category. Provide a root category as parent.');
      }
    }

    return this.prisma.category.create({
      data: {
        ...createCategoryDto,
        image: imageUrl,
      },
    });
  }

  findAll() {
    return this.prisma.category.findMany({
      where: {
        is_hidden: false,
      },
      include: {
        children: true,
      },
      orderBy: {
        display_order: 'asc',
      },
    });
  }

  /** Return only root/parent categories (parent_id is null) */
  async getParents() {
    return this.prisma.category.findMany({
      where: { parent_id: null },
      select: {
        id: true,
        name: true,
        image: true,
        display_order: true,
        is_hidden: true,
      },
      orderBy: { display_order: 'asc' },
    });
  }

  /** Return only child categories (parent_id is not null) with minimal parent info */
  async getChildren() {
    return this.prisma.category.findMany({
      where: { parent_id: { not: null } },
      select: {
        id: true,
        name: true,
        image: true,
        display_order: true,
        is_hidden: true,
        parent_id: true,
        parent: { select: { id: true, name: true } },
      },
      orderBy: { display_order: 'asc' },
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        children: true,
        parent: true,
      },
    });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    return category;
  }

  async update(id: number, updateCategoryDto: UpdateCategoryDto, imageUrl?: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });

    if (!category) {
      throw new NotFoundException('Category not found');
    }

    const { parent_id } = updateCategoryDto as any;
    if (parent_id !== undefined) {
      if (parent_id === null) {
        // allowing setting to root
      } else {
        const parent = await this.prisma.category.findUnique({ where: { id: parent_id } });
        if (!parent) throw new NotFoundException('Parent category not found');
        if (parent.parent_id !== null) {
          throw new BadRequestException('Cannot set parent to a child category. Only root categories can have children.');
        }
      }
    }

    const dataToUpdate: any = { ...updateCategoryDto };
    if (imageUrl) {
      dataToUpdate.image = imageUrl;
    }

    const updatedCategory = await this.prisma.category.update({
      where: { id },
      data: dataToUpdate,
    });

    return updatedCategory;
  }

  remove(id: number) {
    return this.prisma.category.update({
      where: { id },
      data: { is_hidden: true },
    });
  }
}
