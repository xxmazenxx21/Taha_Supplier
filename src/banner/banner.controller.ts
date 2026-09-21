import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { multerOptions, validateImageFiles } from '../utils/multer/multer';
import {
  getUploadPublicPath,
  UploadFolder,
} from '../utils/multer/upload-paths';
import { BannerService } from './banner.service';
import { CreateBannerDto } from './dto/create-banner.dto';
import { UpdateBannerDto } from './dto/update-banner.dto';

@Controller('banner')
export class BannerController {
  constructor(private readonly bannerService: BannerService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FilesInterceptor('images', 10, multerOptions(UploadFolder.BANNERS)),
  )
  async create(
    @Body() dto: CreateBannerDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const uploadedFiles = files ?? [];
    await this.validateUploadedFiles(uploadedFiles);

    if (uploadedFiles.length === 0) {
      throw new BadRequestException('At least one banner image is required');
    }

    return this.bannerService.create(
      dto,
      uploadedFiles.map((file) =>
        getUploadPublicPath(UploadFolder.BANNERS, file.filename),
      ),
    );
  }

  @Get()
  @Roles(UserRole.ADMIN,UserRole.CLIENT)
  findAll() {
    return this.bannerService.findAll();
  }

  @Get(':id')
   @Roles(UserRole.ADMIN,UserRole.CLIENT)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.bannerService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FilesInterceptor('images', 10, multerOptions(UploadFolder.BANNERS)),
  )
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBannerDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    const uploadedFiles = files ?? [];
    await this.validateUploadedFiles(uploadedFiles);

    return this.bannerService.update(
      id,
      dto,
      uploadedFiles.map((file) =>
        getUploadPublicPath(UploadFolder.BANNERS, file.filename),
      ),
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.bannerService.remove(id);
  }

  private async validateUploadedFiles(
    files: Express.Multer.File[],
  ): Promise<void> {
    try {
      validateImageFiles(files);
    } catch (error) {
      await Promise.all(
        files.map((file) =>
          import('node:fs/promises').then(({ unlink }) =>
            unlink(file.path).catch(() => {}),
          ),
        ),
      );
      throw error;
    }
  }
}
