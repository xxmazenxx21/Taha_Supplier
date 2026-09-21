import { IsString, IsNotEmpty } from 'class-validator';

export class ApplyCouponDto {
  @IsString()
  @IsNotEmpty()
  code: string;
}
