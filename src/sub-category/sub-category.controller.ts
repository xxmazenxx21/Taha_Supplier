import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { SubCategoryService } from './sub-category.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { FindAdminSubCategoriesDto } from './dto/find-admin-sub-categories.dto';
import { multerOptions, validateImageFiles } from '../utils/multer/multer';
import {
  UploadFolder,
  getUploadPublicPath,
} from '../utils/multer/upload-paths';

@Controller('sub-category')
export class SubCategoryController {
  constructor(private readonly subCategoryService: SubCategoryService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', multerOptions(UploadFolder.SUB_CATEGORY)),
  )
  create(
    @Body() createSubCategoryDto: CreateSubCategoryDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (image) {
      validateImageFiles([image]);
    }

    const imageUrl = image
      ? getUploadPublicPath(UploadFolder.SUB_CATEGORY, image.filename)
      : undefined;

    return this.subCategoryService.create(createSubCategoryDto, imageUrl);
  }

  @Get()
  findAll() {
    return this.subCategoryService.findAll();
  }

  // Must stay declared before @Get(':id')
  @Get('admin')
  @Roles(UserRole.ADMIN)
  findAllforAdmin(@Query() query: FindAdminSubCategoriesDto) {
    return this.subCategoryService.findAllforAdmin(query);
  }

  // Must stay declared before @Get(':id')
  @Get('admin/:id')
  @Roles(UserRole.ADMIN)
  findOneForAdmin(@Param('id') id: string) {
    return this.subCategoryService.findOneForAdmin(this.parseId(id));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subCategoryService.findOne(+id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', multerOptions(UploadFolder.SUB_CATEGORY)),
  )
  update(
    @Param('id') id: string,
    @Body() updateSubCategoryDto: UpdateSubCategoryDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (image) {
      validateImageFiles([image]);
    }

    const imageUrl = image
      ? getUploadPublicPath(UploadFolder.SUB_CATEGORY, image.filename)
      : undefined;

    return this.subCategoryService.update(+id, updateSubCategoryDto, imageUrl);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.subCategoryService.remove(+id);
  }

  private parseId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('Invalid sub category id');
    }
    return id;
  }
}
