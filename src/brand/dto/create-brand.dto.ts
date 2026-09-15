import { IsString, MinLength, IsOptional, ArrayUnique, ArrayNotEmpty, IsInt, IsArray } from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @MinLength(2)
  name: string;

  // Optional list of category IDs to associate with this brand on create
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  category_ids?: number[];
}
