import {
  IsEmail,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SignupDto {
  @IsString()
  @MinLength(2)
  name: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  shop_name?: string;

  @IsString()
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'phone must be a valid international phone number',
  })
  phone: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  longitude?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fcm_token?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  platform?: string;
}
