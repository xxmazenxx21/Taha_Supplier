import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsObject, IsOptional, Min } from 'class-validator';
import { BannerActionType } from '../../../generated/prisma/client.js';

export class BannerImageConfigDto {
  // Used only when updating the action/order of an existing image.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  image_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sort_order?: number;

  @IsOptional()
  @IsEnum(BannerActionType)
  click_action_type?: BannerActionType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  click_target_id?: number;

  @IsOptional()
  @IsObject()
  click_target_data?: Record<string, unknown>;
}
