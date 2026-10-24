import { IsOptional, IsString } from 'class-validator';

export class AddBannerImagesDto {
  // Multipart requests send this as one JSON string containing an array,
  // with one configuration object per uploaded file.
  @IsOptional()
  @IsString()
  image_configs?: string;
}
