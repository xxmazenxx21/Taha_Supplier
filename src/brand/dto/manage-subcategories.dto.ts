import { IsArray, ArrayNotEmpty, ArrayUnique, IsInt } from 'class-validator';

export class ManageSubcategoriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsInt({ each: true })
  subcategory_ids: number[];
}
