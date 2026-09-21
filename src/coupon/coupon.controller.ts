import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { CouponService } from './coupon.service';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { Roles } from '../decorators/roles.decorator';
import { RolesGuard } from '../guards/roles.guard';

@Controller('coupon')
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  /** Create a new coupon (admin only) */
  @Post()
  create(@Body() createCouponDto: CreateCouponDto) {
    return this.couponService.create(createCouponDto);
  }

  /** Get all coupons with no filters (admin only) */
  @Get()
  getAllCouponForAdmin() {
    return this.couponService.getAllCouponForAdmin();
  }

  /** Get single coupon by id (admin only) */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.couponService.findOne(+id);
  }

  /** Update coupon (admin only) */
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateCouponDto: UpdateCouponDto) {
    return this.couponService.update(+id, updateCouponDto);
  }

  /** Hard delete coupon (admin only) */
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.couponService.remove(+id);
  }
}
