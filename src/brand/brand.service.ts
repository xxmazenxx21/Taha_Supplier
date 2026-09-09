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
    const existingBrand = await this.prisma.brand.findUnique({
      where: { name: createBrandDto.name },
    });

    if (existingBrand) {
      // Duplicate name detected before DB write — clean up the already-uploaded logo
      await this.deleteLocalFiles([createBrandDto.logo]);
      throw new ConflictException('Brand with this name already exists');
    }

    try {
      return await this.prisma.brand.create({ data: createBrandDto });
    } catch (error) {
      // DB write failed for any other reason — clean up the orphaned logo
      await this.deleteLocalFiles([createBrandDto.logo]);
      throw error;
    }
  }

  findAll() {
    return `This action returns all brand`;
  }

  findOne(id: number) {
    return `This action returns a #${id} brand`;
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
