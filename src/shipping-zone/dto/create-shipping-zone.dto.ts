import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
} from 'class-validator';

export class CreateShippingZoneDto {
  @IsString()
  name: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  shipping_cost: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  display_order?: number;
}
