import {
  IsString,
  MinLength,
  IsOptional,
  ArrayUnique,
  ArrayNotEmpty,
  IsInt,
  IsArray,
} from 'class-validator';

export class CreateBrandDto {
  @IsString()
  @MinLength(2)
  name: string;

  // Optional list of subcategory IDs to associate with this brand on create
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  subcategory_ids?: number[];
}
