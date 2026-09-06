import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { multerOptions } from '../utils/multer/multer';
import { getUploadDirectory, getUploadPublicPath, UploadFolder } from '../utils/multer/upload-paths';
import { BrandService } from './brand.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { unlink } from 'fs/promises';

@Controller('brand')
export class BrandController {
  constructor(private readonly brandService: BrandService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('logo', multerOptions(UploadFolder.BRANDS)))
  async create(
    @Body() createBrandDto: CreateBrandDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|jpg|png|webp)$/ }),
        ],
      }),
    )
    logo: Express.Multer.File,
  ) {
    try {
      return await this.brandService.create({
      ...createBrandDto,
      logo: getUploadPublicPath(UploadFolder.BRANDS, logo.filename),
    });
    } catch (error) {
         // لو فشلت عملية الحفظ في الداتابيز لأي سبب، امسح الملف اليتيم من الديسك
    await unlink(getUploadDirectory(UploadFolder.BRANDS) + `/${logo.filename}`).catch(() => {});
    throw error;
    }   
  }

  @Get()
  findAll() {
    return this.brandService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandService.findOne(+id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('logo', multerOptions(UploadFolder.BRANDS)))
  update(
    @Param('id') id: string,
    @Body() updateBrandDto: UpdateBrandDto,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|jpg|png|webp)$/ }),
        ],
      }),
    )
    logo?: Express.Multer.File,
  ) {
    return this.brandService.update(
      +id,
      updateBrandDto,
      logo ? getUploadPublicPath(UploadFolder.BRANDS, logo.filename) : undefined,
    );
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.brandService.remove(+id);
  }
}
