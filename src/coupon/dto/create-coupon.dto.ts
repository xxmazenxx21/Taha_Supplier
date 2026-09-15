import { Type } from 'class-transformer';
import { IsString, IsEnum, IsNumber, IsOptional, IsInt, IsDateString } from 'class-validator';

export enum DiscountTypeDto {
	PERCENTAGE = 'PERCENTAGE',
	FIXED = 'FIXED',
}

export enum CouponStatusDto {
	ACTIVE = 'ACTIVE',
	PAUSED = 'PAUSED',
}

export class CreateCouponDto {
	@IsString()
	code: string;

	@IsEnum(DiscountTypeDto)
	discount_type: DiscountTypeDto;

	@Type(() => Number)
	@IsNumber()
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
