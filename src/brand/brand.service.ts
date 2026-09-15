import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { basename, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { getUploadDirectory, UploadFolder } from '../utils/multer/upload-paths';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';

@Injectable()
export class BrandService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createBrandDto: CreateBrandDto & { logo: string }) {
    const { category_ids, ...brandData } = createBrandDto as any;

    const existingBrand = await this.prisma.brand.findUnique({
      where: { name: brandData.name },
    });

    if (existingBrand) {
      // Duplicate name detected before DB write — clean up the already-uploaded logo
      await this.deleteLocalFiles([brandData.logo]);
      throw new ConflictException('Brand with this name already exists');
    }

    // If categories were provided, validate they exist
    let uniqueCategoryIds: number[] | undefined;
    if (Array.isArray(category_ids) && category_ids.length > 0) {
      uniqueCategoryIds = Array.from(new Set(category_ids.map((v: any) => Number(v))));
      const found = await this.prisma.category.findMany({ where: { id: { in: uniqueCategoryIds } }, select: { id: true } });
      const foundIds = found.map((c) => c.id);
      const missing = uniqueCategoryIds.filter((id) => !foundIds.includes(id));
      if (missing.length > 0) {
        // Clean up the uploaded logo
        await this.deleteLocalFiles([brandData.logo]);
        throw new NotFoundException(`Categories not found: ${missing.join(', ')}`);
      }
    }

    try {
      const created = await this.prisma.brand.create({
        data: {
          ...brandData,
          ...(uniqueCategoryIds && uniqueCategoryIds.length > 0
            ? {
                brandCategories: {
                  create: uniqueCategoryIds.map((category_id) => ({ category: { connect: { id: category_id } } })),
                },
              }
            : {}),
        },
      });

      return created;
    } catch (error) {
      // DB write failed for any other reason — clean up the orphaned logo
      await this.deleteLocalFiles([brandData.logo]);
      throw error;
    }
  }

  /**
   * Add associations between a brand and multiple categories.
   * Validates brand and categories exist. Ignores already-existing relations.
   */
  async addCategories(brandId: number, categoryIds: number[]) {
    const brand = await this.prisma.brand.findFirst({ where: { id: brandId, deleted_at: null } });
    if (!brand) throw new NotFoundException('Brand not found');

    const uniqueIds = Array.from(new Set(categoryIds.map((v) => Number(v))));
    const found = await this.prisma.category.findMany({ where: { id: { in: uniqueIds } }, select: { id: true } });
    const foundIds = found.map((c) => c.id);
    const missing = uniqueIds.filter((id) => !foundIds.includes(id));
    if (missing.length > 0) throw new NotFoundException(`Categories not found: ${missing.join(', ')}`);

    // Create relations, skipping existing ones
    const toCreate = uniqueIds.map((category_id) => ({ brand_id: brandId, category_id }));
    // Use createMany with skipDuplicates to avoid errors if relations already exist
    await this.prisma.brandCategory.createMany({ data: toCreate, skipDuplicates: true });

    return this.prisma.brand.findUnique({ where: { id: brandId }, include: { brandCategories: { include: { category: true } } } });
  }

  /** Remove a single BrandCategory association */
  async removeCategory(brandId: number, categoryId: number) {
    const rel = await this.prisma.brandCategory.findFirst({ where: { brand_id: brandId, category_id: categoryId } });
    if (!rel) throw new NotFoundException('Brand-category relation not found');

    await this.prisma.brandCategory.delete({ where: { id: rel.id } });
    return { deleted: true };
  }











  findAll() {
    return this.prisma.brand.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        name: true,
        logo: true,
        created_at: true,
        updated_at: true,
        brandCategories: { select: { category: { select: { id: true, name: true } } } },
      },
      orderBy: { created_at: 'desc' },
    });
  }













  async findOne(id: number) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, deleted_at: null },
      include: { brandCategories: { include: { category: { select: { id: true, name: true } } } } },
    });

    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }
















  
  async update(
    id: number,
    updateBrandDto: UpdateBrandDto,
    newLogoPath?: string,
  ) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, deleted_at: null },
    });

    if (!brand) {
      // Brand not found — clean up newly uploaded logo if any
      if (newLogoPath) await this.deleteLocalFiles([newLogoPath]);
      throw new NotFoundException('Brand not found');
    }

    if (updateBrandDto.name) {
      const duplicateBrand = await this.prisma.brand.findFirst({
        where: { name: updateBrandDto.name, id: { not: id } },
      });

      if (duplicateBrand) {
        // Duplicate name — clean up newly uploaded logo if any
        if (newLogoPath) await this.deleteLocalFiles([newLogoPath]);
        throw new ConflictException('Brand with this name already exists');
      }
    }

    try {
      const updatedBrand = await this.prisma.brand.update({
        where: { id },
        data: {
          ...updateBrandDto,
          ...(newLogoPath && { logo: newLogoPath }),
        },
      });

      // DB write succeeded — now safe to delete the old logo from disk
      if (newLogoPath && brand.logo !== newLogoPath) {
        await this.deleteOldLogo(brand.logo);
      }

      return updatedBrand;
    } catch (error) {
      // DB write failed — clean up the new logo that was already saved to disk
      if (newLogoPath) await this.deleteLocalFiles([newLogoPath]);
      throw error;
    }
  }

  async remove(id: number) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, deleted_at: null },
    });

    if (!brand) {
      throw new NotFoundException('Brand not found');
    }

    return this.prisma.brand.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }

  /**
   * Deletes local files by their public URL paths (e.g. /uploads/brands/xxx.jpg).
   * Errors are silently swallowed — a missing file should never crash a request.
   */
  private async deleteLocalFiles(publicPaths: string[]): Promise<void> {
    await Promise.all(
      publicPaths.map((p) => fs.unlink(join(process.cwd(), p)).catch(() => {})),
    );
  }

  /**
   * Deletes the old logo file from disk after a successful logo replacement.
   * Only acts on paths within the brands upload folder to prevent path traversal.
   */
  private async deleteOldLogo(logoPath: string | null): Promise<void> {
    const uploadPrefix = `/uploads/${UploadFolder.BRANDS}/`;

    if (!logoPath?.startsWith(uploadPrefix)) {
      return;
    }

    const brandsDirectory = getUploadDirectory(UploadFolder.BRANDS);
    const filePath = resolve(brandsDirectory, basename(logoPath));

    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(filePath);
    } catch (error: unknown) {
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
}
