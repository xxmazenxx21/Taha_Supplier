import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendBroadcastNotificationDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  body?: string;
}
