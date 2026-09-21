import { Type } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsInt,
  IsDateString,
  IsEnum,
  Min,
  Max,
} from 'class-validator';

export enum CouponStatusDto {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
}

export class CreateCouponDto {
  @IsString()
  code: string;

  /**
   * Percentage discount value (1 – 100)
   */
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  discount_value: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  min_order_amount?: number;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  usage_limit?: number;

  @IsOptional()
  @IsEnum(CouponStatusDto)
  status?: CouponStatusDto;
}
