import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
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
      throw new ConflictException('Brand with this name already exists');
    }
    return await this.prisma.brand.create({
      data: createBrandDto,
      
    });
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
      throw new NotFoundException('Brand not found');
    }

    if (updateBrandDto.name) {
      const duplicateBrand = await this.prisma.brand.findFirst({
        where: { name: updateBrandDto.name, id: { not: id } },
      });

      if (duplicateBrand) {
        throw new ConflictException('Brand with this name already exists');
      }
    }

    const updatedBrand = await this.prisma.brand.update({
      where: { id },
      data: {
        ...updateBrandDto,
        ...(newLogoPath && { logo: newLogoPath }),
      },
    });

    if (newLogoPath && brand.logo !== newLogoPath) {
      await this.deleteOldLogo(brand.logo);
    }

    return updatedBrand;
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

  private async deleteOldLogo(logoPath: string | null): Promise<void> {
    const uploadPrefix = `/uploads/${UploadFolder.BRANDS}/`;

    if (!logoPath?.startsWith(uploadPrefix)) {
      return;
    }

    const brandsDirectory = getUploadDirectory(UploadFolder.BRANDS);
    const filePath = resolve(brandsDirectory, basename(logoPath));

    try {
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
