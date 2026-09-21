import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { BannerActionType, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { FindAllProductsDto } from '../product/dto/find-all-products.dto';
import { BannerImageConfigDto } from './dto/banner-image-config.dto';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

type NormalizedImageConfig = {
  image_id?: number;
  sort_order: number;
  click_action_type: BannerActionType;
  click_target_id: number | null;
  click_target_data: Prisma.InputJsonValue | null;
};

@Injectable()
export class BannerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBannerDto, imageUrls: string[]) {
    try {
      if (imageUrls.length === 0) {
        throw new BadRequestException('At least one banner image is required');
      }

      const configs = this.parseImageConfigs(
        dto.image_configs,
        imageUrls.length,
      );
      const normalizedConfigs = await this.validateActionConfigs(configs);

      return await this.prisma.banner.create({
        data: {
          title: dto.title ?? null,
          is_active: dto.is_active ?? true,
          sort_order: dto.sort_order ?? 0,
          images: {
            create: normalizedConfigs.map((config, index) =>
              this.toImageCreateData(config, imageUrls[index]),
            ),
          },
        },
        include: this.imagesInclude(),
      });
    } catch (error) {
      await this.deleteLocalFiles(imageUrls);
      throw error;
    }
  }

  findAll() {
    return this.prisma.banner.findMany({
      orderBy: [{ sort_order: 'asc' }, { created_at: 'desc' }],
      include: this.imagesInclude(),
    });
  }

  async findOne(id: number) {
    const banner = await this.prisma.banner.findUnique({
      where: { id },
      include: this.imagesInclude(),
    });

    if (!banner) {
      throw new NotFoundException('Banner not found');
    }

    return banner;
  }

  async update(id: number, dto: UpdateBannerDto, imageUrls: string[]) {
    const existing = await this.prisma.banner.findUnique({
      where: { id },
      include: this.imagesInclude(),
    });

    if (!existing) {
      await this.deleteLocalFiles(imageUrls);
      throw new NotFoundException('Banner not found');
    }

    try {
      if (imageUrls.length > 0) {
        const configs = this.parseImageConfigs(
          dto.image_configs,
          imageUrls.length,
        );
        const normalizedConfigs = await this.validateActionConfigs(configs);

        const updated = await this.prisma.banner.update({
          where: { id },
          data: {
            ...this.scalarUpdateData(dto),
            images: {
              deleteMany: {},
              create: normalizedConfigs.map((config, index) =>
                this.toImageCreateData(config, imageUrls[index]),
              ),
            },
          },
          include: this.imagesInclude(),
        });

        await this.deleteLocalFiles(
          existing.images.map((image) => image.image_url),
        );
        return updated;
      }

      if (dto.image_configs !== undefined) {
        const configs = this.parseImageConfigs(dto.image_configs);
        if (configs.length === 0) {
          throw new BadRequestException(
            'image_configs must contain at least one existing image configuration',
          );
        }

        const mergedConfigs = this.mergeExistingConfigs(
          configs,
          existing.images,
        );
        const normalizedConfigs =
          await this.validateActionConfigs(mergedConfigs);

        return await this.prisma.$transaction(async (tx) => {
          for (const config of normalizedConfigs) {
            if (!config.image_id) {
              throw new BadRequestException(
                'image_id is required when updating existing banner images',
              );
            }

            await tx.bannerImage.update({
              where: { id: config.image_id },
              data: {
                sort_order: config.sort_order,
                click_action_type: config.click_action_type,
                click_target_id: config.click_target_id,
                click_target_data: config.click_target_data ?? Prisma.JsonNull,
              },
            });
          }

          return tx.banner.update({
            where: { id },
            data: this.scalarUpdateData(dto),
            include: this.imagesInclude(),
          });
        });
      }

      return await this.prisma.banner.update({
        where: { id },
        data: this.scalarUpdateData(dto),
        include: this.imagesInclude(),
      });
    } catch (error) {
      await this.deleteLocalFiles(imageUrls);
      throw error;
    }
  }

  async remove(id: number) {
    const banner = await this.prisma.banner.findUnique({
      where: { id },
      include: { images: true },
    });

    if (!banner) {
      throw new NotFoundException('Banner not found');
    }

    await this.prisma.banner.delete({ where: { id } });
    await this.deleteLocalFiles(banner.images.map((image) => image.image_url));

    return { success: true };
  }

  private imagesInclude() {
    return {
      images: {
        orderBy: { sort_order: 'asc' as const },
      },
    };
  }

  private scalarUpdateData(dto: UpdateBannerDto) {
    return {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      ...(dto.sort_order !== undefined && { sort_order: dto.sort_order }),
    };
  }

  private parseImageConfigs(
    rawConfigs: string | undefined,
    expectedCount?: number,
  ): BannerImageConfigDto[] {
    if (rawConfigs === undefined || rawConfigs.trim() === '') {
      if (expectedCount === undefined) {
        return [];
      }

      return plainToInstance(
        BannerImageConfigDto,
        Array.from({ length: expectedCount }, (_, index) => ({
          sort_order: index,
          click_action_type: BannerActionType.NONE,
        })),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawConfigs);
    } catch {
      throw new BadRequestException('image_configs must be valid JSON');
    }

    if (!Array.isArray(parsed)) {
      throw new BadRequestException('image_configs must be a JSON array');
    }

    if (expectedCount !== undefined && parsed.length !== expectedCount) {
      throw new BadRequestException(
        'image_configs must contain one configuration for each uploaded image',
      );
    }

    const prepared = parsed.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new BadRequestException(
          'Each image configuration must be an object',
        );
      }

      const config = { ...(value as Record<string, unknown>) };
      if (typeof config.click_target_data === 'string') {
        try {
          config.click_target_data = JSON.parse(config.click_target_data);
        } catch {
          throw new BadRequestException(
            'click_target_data must be valid JSON when sent as a string',
          );
        }
      }
      return config;
    });

    const configs = plainToInstance(BannerImageConfigDto, prepared);
    const errors = configs.flatMap((config) =>
      validateSync(config, {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
      }),
    );

    if (errors.length > 0) {
      throw new BadRequestException('Invalid banner image configuration');
    }

    return configs;
  }

  private mergeExistingConfigs(
    configs: BannerImageConfigDto[],
    existingImages: Array<{
      id: number;
      sort_order: number;
      click_action_type: BannerActionType;
      click_target_id: number | null;
      click_target_data: Prisma.JsonValue;
    }>,
  ): BannerImageConfigDto[] {
    const existingById = new Map(
      existingImages.map((image) => [image.id, image]),
    );
    const seenIds = new Set<number>();

    return configs.map((config) => {
      if (!config.image_id) {
        throw new BadRequestException(
          'image_id is required when updating existing banner images',
        );
      }

      const existing = existingById.get(config.image_id);
      if (!existing) {
        throw new NotFoundException('Banner image not found');
      }
      if (seenIds.has(config.image_id)) {
        throw new BadRequestException('An image cannot be configured twice');
      }
      seenIds.add(config.image_id);

      const actionWasProvided = config.click_action_type !== undefined;
      return plainToInstance(BannerImageConfigDto, {
        image_id: config.image_id,
        sort_order: config.sort_order ?? existing.sort_order,
        click_action_type: actionWasProvided
          ? config.click_action_type
          : existing.click_action_type,
        click_target_id:
          config.click_target_id !== undefined
            ? config.click_target_id
            : actionWasProvided
              ? null
              : existing.click_target_id,
        click_target_data:
          config.click_target_data !== undefined
            ? config.click_target_data
            : actionWasProvided
              ? null
              : existing.click_target_data,
      });
    });
  }

  private async validateActionConfigs(
    configs: BannerImageConfigDto[],
  ): Promise<NormalizedImageConfig[]> {
    const normalized = configs.map((config, index) => ({
      image_id: config.image_id,
      sort_order: config.sort_order ?? index,
      click_action_type: config.click_action_type ?? BannerActionType.NONE,
      click_target_id: config.click_target_id ?? null,
      click_target_data: (config.click_target_data ??
        null) as Prisma.InputJsonValue | null,
    }));

    for (const config of normalized) {
      switch (config.click_action_type) {
        case BannerActionType.NONE:
          this.requireNoActionTarget(config);
          break;
        case BannerActionType.CATEGORY:
          this.requireIdTarget(config, 'CATEGORY');
          if (
            !(await this.prisma.category.findUnique({
              where: { id: config.click_target_id as number },
              select: { id: true },
            }))
          ) {
            throw new NotFoundException('Category not found');
          }
          break;
        case BannerActionType.PRODUCT:
          this.requireIdTarget(config, 'PRODUCT');
          if (
            !(await this.prisma.product.findUnique({
              where: { id: config.click_target_id as number },
              select: { id: true },
            }))
          ) {
            throw new NotFoundException('Product not found');
          }
          break;
        case BannerActionType.BRAND:
          this.requireIdTarget(config, 'BRAND');
          if (
            !(await this.prisma.brand.findFirst({
              where: {
                id: config.click_target_id as number,
                deleted_at: null,
              },
              select: { id: true },
            }))
          ) {
            throw new NotFoundException('Brand not found');
          }
          break;
        case BannerActionType.FILTER:
          this.validateFilterTarget(config);
          break;
        case BannerActionType.PAGE:
          throw new BadRequestException(
            'PAGE action is UNKNOWN / VERIFY IN SOURCE',
          );
      }
    }

    return normalized;
  }

  private requireNoActionTarget(config: NormalizedImageConfig): void {
    if (config.click_target_id !== null || config.click_target_data !== null) {
      throw new BadRequestException(
        'NONE action cannot have click_target_id or click_target_data',
      );
    }
  }

  private requireIdTarget(config: NormalizedImageConfig, action: string): void {
    if (config.click_target_id === null || config.click_target_data !== null) {
      throw new BadRequestException(
        `${action} action requires click_target_id and no click_target_data`,
      );
    }
  }

  private validateFilterTarget(config: NormalizedImageConfig): void {
    if (
      config.click_target_id !== null ||
      config.click_target_data === null ||
      typeof config.click_target_data !== 'object' ||
      Array.isArray(config.click_target_data) ||
      Object.keys(config.click_target_data).length === 0
    ) {
      throw new BadRequestException(
        'FILTER action requires a non-empty click_target_data object and no click_target_id',
      );
    }

    const filterDto = plainToInstance(
      FindAllProductsDto,
      config.click_target_data,
    );
    const errors = validateSync(filterDto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });

    if (errors.length > 0) {
      throw new BadRequestException(
        'click_target_data contains unsupported product filters',
      );
    }
  }

  private toImageCreateData(config: NormalizedImageConfig, imageUrl: string) {
    return {
      image_url: imageUrl,
      sort_order: config.sort_order,
      click_action_type: config.click_action_type,
      click_target_id: config.click_target_id,
      click_target_data: config.click_target_data ?? Prisma.JsonNull,
    };
  }

  /** Missing local files are intentionally ignored, matching existing modules. */
  private async deleteLocalFiles(publicPaths: string[]): Promise<void> {
    await Promise.all(
      publicPaths.map((publicPath) =>
        fs.unlink(join(process.cwd(), publicPath)).catch(() => {}),
      ),
    );
  }
}
