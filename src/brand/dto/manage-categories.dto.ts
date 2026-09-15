import { IsArray, ArrayNotEmpty, ArrayUnique, IsInt } from 'class-validator';

export class ManageCategoriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  category_ids: number[];
}
