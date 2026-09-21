import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBannerDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @Transform((params) => {
    const value: unknown = params.value as unknown;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;

  // Multipart requests send this as one JSON string containing an array.
  @IsOptional()
  @IsString()
  image_configs?: string;
}
