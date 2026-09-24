import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateFcmTokenDto {
  @IsString()
  @IsNotEmpty()
  fcm_token: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  platform?: string;
}
