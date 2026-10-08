import {
  BadRequestException,
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
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { multerOptions, validateImageFiles } from '../utils/multer/multer';
import {
  UploadFolder,
  getUploadPublicPath,
} from '../utils/multer/upload-paths';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}
  // adminDashboard
  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', multerOptions(UploadFolder.CATEGORIES)),
  )
  create(
    @Body() createCategoryDto: CreateCategoryDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (image) {
      validateImageFiles([image]);
    }

    const imageUrl = image
      ? getUploadPublicPath(UploadFolder.CATEGORIES, image.filename)
      : undefined;

    return this.categoryService.create(createCategoryDto, imageUrl);
  }

  //fluter
  @Get()
  findAll() {
    return this.categoryService.findAll();
  }

  //admindashboard — must stay declared before @Get(':id')
  @Get('admin')
  @Roles(UserRole.ADMIN)
  findAllforAdmin() {
    return this.categoryService.findAllforAdmin();
  }

  //admindashboard — must stay declared before @Get(':id')
  @Get('admin/:id')
  @Roles(UserRole.ADMIN)
  findOneForAdmin(@Param('id') id: string) {
    return this.categoryService.findOneForAdmin(this.parseId(id));
  }

  //flutter
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoryService.findOne(+id);
  }
  //admindashboard
  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', multerOptions(UploadFolder.CATEGORIES)),
  )
  update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (image) {
      validateImageFiles([image]);
    }

    const imageUrl = image
      ? getUploadPublicPath(UploadFolder.CATEGORIES, image.filename)
      : undefined;

    return this.categoryService.update(+id, updateCategoryDto, imageUrl);
  }
  //admindashboard
  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.categoryService.remove(+id);
  }

  private parseId(value: string): number {
    const id = Number(value);
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('Invalid category id');
    }
    return id;
  }
}
