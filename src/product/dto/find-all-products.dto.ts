import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, IsIn } from 'class-validator';

export class FindAllProductsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subcategory_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  available?: number;

  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  offers?: number;

  @IsOptional()
  @Type(() => Number)
  min_rating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brand_id?: number;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  per_page?: number = 10;
}
