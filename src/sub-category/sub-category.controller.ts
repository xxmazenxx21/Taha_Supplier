import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SubCategoryService } from './sub-category.service';
import { CreateSubCategoryDto } from './dto/create-sub-category.dto';
import { UpdateSubCategoryDto } from './dto/update-sub-category.dto';
import { multerOptions, validateImageFiles } from '../utils/multer/multer';
import { UploadFolder, getUploadPublicPath } from '../utils/multer/upload-paths';

@Controller('sub-category')
export class SubCategoryController {
  constructor(private readonly subCategoryService: SubCategoryService) {}

  @Post()
  @UseInterceptors(FileInterceptor('image', multerOptions(UploadFolder.SUB_CATEGORY)))
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

  @Get('admin')
  findAllforAdmin() {
    return this.subCategoryService.findAllforAdmin();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.subCategoryService.findOne(+id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('image', multerOptions(UploadFolder.SUB_CATEGORY)))
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
  remove(@Param('id') id: string) {
    return this.subCategoryService.remove(+id);
  }
}
