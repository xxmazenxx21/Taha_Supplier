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
    const { subcategory_ids, ...brandData } = createBrandDto as any;

    const existingBrand = await this.prisma.brand.findUnique({
      where: { name: brandData.name },
    });

    if (existingBrand) {
      // Duplicate name detected before DB write — clean up the already-uploaded logo
      await this.deleteLocalFiles([brandData.logo]);
      throw new ConflictException('Brand with this name already exists');
    }

    // If subcategories were provided, validate they exist
    let uniqueSubcategoryIds: number[] | undefined;
    if (Array.isArray(subcategory_ids) && subcategory_ids.length > 0) {
      uniqueSubcategoryIds = Array.from(
        new Set(subcategory_ids.map((v: any) => Number(v))),
      );
      const found = await this.prisma.subCategory.findMany({
        where: { id: { in: uniqueSubcategoryIds } },
        select: { id: true },
      });
      const foundIds = found.map((s) => s.id);
      const missing = uniqueSubcategoryIds.filter(
        (id) => !foundIds.includes(id),
      );
      if (missing.length > 0) {
        await this.deleteLocalFiles([brandData.logo]);
        throw new NotFoundException(
          `Subcategories not found: ${missing.join(', ')}`,
        );
      }
    }

    try {
      const created = await this.prisma.brand.create({
        data: {
          ...brandData,
          ...(uniqueSubcategoryIds && uniqueSubcategoryIds.length > 0
            ? {
                brandSubCategories: {
                  create: uniqueSubcategoryIds.map((subcategory_id) => ({
                    subCategory: { connect: { id: subcategory_id } },
                  })),
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
   * Add associations between a brand and multiple subcategories.
   * Validates brand and subcategories exist. Ignores already-existing relations.
   */
  async addSubcategories(brandId: number, subcategoryIds: number[]) {
    const brand = await this.prisma.brand.findFirst({
      where: { id: brandId, deleted_at: null },
    });
    if (!brand) throw new NotFoundException('Brand not found');

    const uniqueIds = Array.from(new Set(subcategoryIds.map((v) => Number(v))));
    const found = await this.prisma.subCategory.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true },
    });
    const foundIds = found.map((s) => s.id);
    const missing = uniqueIds.filter((id) => !foundIds.includes(id));
    if (missing.length > 0)
      throw new NotFoundException(
        `Subcategories not found: ${missing.join(', ')}`,
      );

    // Create relations, skipping existing ones
    const toCreate = uniqueIds.map((subcategory_id) => ({
      brand_id: brandId,
      subcategory_id,
    }));
    await this.prisma.brandSubCategory.createMany({
      data: toCreate,
      skipDuplicates: true,
    });

    return this.prisma.brand.findUnique({
      where: { id: brandId },
      include: { brandSubCategories: { include: { subCategory: true } } },
    });
  }

  /** Remove a single BrandSubCategory association */
  async removeSubcategory(brandId: number, subcategoryId: number) {
    const rel = await this.prisma.brandSubCategory.findFirst({
      where: { brand_id: brandId, subcategory_id: subcategoryId },
    });
    if (!rel)
      throw new NotFoundException('Brand-subcategory relation not found');

    await this.prisma.brandSubCategory.delete({ where: { id: rel.id } });
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
        brandSubCategories: {
          select: { subCategory: { select: { id: true, name: true } } },
        },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  //return brand without subcatigories
  async findAllForAdmin() {
    return await this.prisma.brand.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        name: true,
        logo: true,
        created_at: true,
        updated_at: true,
      },
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(id: number) {
    const brand = await this.prisma.brand.findFirst({
      where: { id, deleted_at: null },
      include: {
        brandSubCategories: {
          include: {
            subCategory: { select: { id: true, name: true, image: true } },
          },
        },
      },
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
