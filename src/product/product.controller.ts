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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FileFieldsInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { UserRole } from '../../generated/prisma/client.js';
import { Roles } from '../decorators/roles.decorator';
import { multerOptions, validateImageFiles } from '../utils/multer/multer';
import { UploadFolder, getUploadPublicPath } from '../utils/multer/upload-paths';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { FindAllProductsDto } from './dto/find-all-products.dto';
import { ProductService } from './product.service';

const productFileFields = [
  { name: 'image', maxCount: 1 },
  { name: 'images', maxCount: 10 },
];

type ProductFiles = {
  image?: Express.Multer.File[];
  images?: Express.Multer.File[];
};

@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @UseInterceptors(
    FileFieldsInterceptor(productFileFields, multerOptions(UploadFolder.PRODUCTS)),
  )
  create(
    @Body() createProductDto: CreateProductDto,
    @UploadedFiles() files: ProductFiles,
  ) {
    if (!files?.image?.length) {
      throw new BadRequestException('Main product image is required');
    }

    validateImageFiles([...(files.image ?? []), ...(files.images ?? [])]);

    const mainImageUrl = getUploadPublicPath(UploadFolder.PRODUCTS, files.image[0].filename);
    const galleryImageUrls = (files.images ?? []).map((file) =>
      getUploadPublicPath(UploadFolder.PRODUCTS, file.filename),
    );

    return this.productService.create(createProductDto, mainImageUrl, galleryImageUrls);
  }

  @Get()
  findAll(@Query() query: FindAllProductsDto) {
    return this.productService.findAll(query);
  }

  @Get('search')
  searchProducts(@Query('q') q: string) {
    if (!q || q.length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters long');
    }
    return this.productService.search(q);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productService.findOne(+id);
  }

  @Get(':id/reviews')
  getReviews(@Param('id') id: string) {
    return this.productService.getReviews(+id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FileInterceptor('image', multerOptions(UploadFolder.PRODUCTS)))
  update(
    @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @UploadedFile() image?: Express.Multer.File,
  ) {
    if (image) {
      validateImageFiles([image]);
    }

    const mainImageUrl = image
      ? getUploadPublicPath(UploadFolder.PRODUCTS, image.filename)
      : undefined;

    return this.productService.update(+id, updateProductDto, mainImageUrl);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.productService.remove(+id);
  }

  // --- Dedicated endpoints for gallery image management ---

  @Post(':id/images')
  @Roles(UserRole.ADMIN)
  @UseInterceptors(FilesInterceptor('images', 10, multerOptions(UploadFolder.PRODUCTS)))
  addImages(
    @Param('id') id: string,
    @UploadedFiles() images: Express.Multer.File[],
  ) {
    if (!images || images.length === 0) {
      throw new BadRequestException('No images provided');
    }

    validateImageFiles(images);

    const galleryImageUrls = images.map((file) =>
      getUploadPublicPath(UploadFolder.PRODUCTS, file.filename),
    );

    return this.productService.addGalleryImages(+id, galleryImageUrls);
  }

  @Delete(':id/images/:imageId')
  @Roles(UserRole.ADMIN)
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.productService.removeGalleryImage(+id, +imageId);
  }
}

