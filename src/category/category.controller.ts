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
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { multerOptions } from '../utils/multer/multer';
import { getUploadPublicPath, UploadFolder } from '../utils/multer/upload-paths';

@Controller('category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', multerOptions(UploadFolder.CATEGORIES)),
  )
  create(
    @Body() createCategoryDto: CreateCategoryDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|jpg|png|webp)$/ }),
        ],
      }),
    )
    image: Express.Multer.File,
  ) {
    return this.categoryService.create({
      ...createCategoryDto,
      image: getUploadPublicPath(UploadFolder.CATEGORIES, image.filename),
    });
  }

  @Get()
  findAll() {
    return this.categoryService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.categoryService.findOne(+id);
  }


@Patch(':id')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileInterceptor('image', multerOptions(UploadFolder.CATEGORIES)),
  )
  update(
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: false,
        validators: [
          new MaxFileSizeValidator({ maxSize: 5 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|jpg|png|webp)$/ }),
        ],
      }),
    )
    image?: Express.Multer.File,
  ) {
    return this.categoryService.update(
      +id,
      updateCategoryDto,
      image
        ? getUploadPublicPath(UploadFolder.CATEGORIES, image.filename)
        : undefined,
    );
  }







  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.categoryService.remove(+id);
  }
}
