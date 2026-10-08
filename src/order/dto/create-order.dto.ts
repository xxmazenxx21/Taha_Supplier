import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaymentMethod } from '../../../generated/prisma/client.js';

export class CreateOrderDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  shipping_zone_id: number;

  @IsEnum(PaymentMethod)
  payment_method: PaymentMethod;

  // payment_proof is an uploaded file (multipart field), never a client-supplied
  // path. The stored path is derived server-side in the controller.

  @IsString()
  @IsNotEmpty()
  delivery_address: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  delivery_lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  delivery_lng?: number;

  @IsOptional()
  @IsString()
  delivery_notes?: string;
}
