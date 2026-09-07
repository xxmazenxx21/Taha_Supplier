import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { ProductStatus } from '../../../generated/prisma/enums';

export class CreateProductDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  brand_id: number;

  @IsString()
  @MinLength(2)
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  // image and images are handled by Multer FileInterceptor

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discount_price?: number;

  @IsString()
  @IsNotEmpty()
  unit: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  display_order?: number;
}
