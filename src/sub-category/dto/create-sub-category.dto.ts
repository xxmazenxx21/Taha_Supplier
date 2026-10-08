import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSubCategoryDto {
  @IsString()
  @MinLength(2)
  @IsNotEmpty()
  name: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  display_order?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_hidden?: boolean;
}
