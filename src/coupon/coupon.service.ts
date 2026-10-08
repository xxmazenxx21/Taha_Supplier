import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCouponDto: CreateCouponDto) {
    const existingCoupon = await this.prisma.coupon.findUnique({
      where: { code: createCouponDto.code },
    });

    if (existingCoupon) {
      throw new ConflictException('Coupon already exists with this code');
    }

    const coupon = await this.prisma.coupon.create({
      data: {
        code: createCouponDto.code,
        discount_value: createCouponDto.discount_value,
        min_order_amount: createCouponDto.min_order_amount ?? undefined,
        start_date: createCouponDto.start_date
          ? new Date(createCouponDto.start_date)
          : undefined,
        end_date: createCouponDto.end_date
          ? new Date(createCouponDto.end_date)
          : undefined,
        usage_limit: createCouponDto.usage_limit ?? undefined,
        status: createCouponDto.status ?? undefined,
      },
    });

    return coupon;
  }

  /** Get all coupons — no filters, admin only */
  async getAllCouponForAdmin() {
    return this.prisma.coupon.findMany({ orderBy: { created_at: 'desc' } });
  }

  async findOne(id: number) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  async update(id: number, updateCouponDto: UpdateCouponDto) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');

    const data: any = { ...updateCouponDto };
    if (updateCouponDto.start_date)
      data.start_date = new Date(updateCouponDto.start_date);
    if (updateCouponDto.end_date)
      data.end_date = new Date(updateCouponDto.end_date);

    return this.prisma.coupon.update({ where: { id }, data });
  }

  /** Hard delete — permanently removes the coupon */
  async remove(id: number) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new NotFoundException('Coupon not found');
    return this.prisma.coupon.delete({ where: { id } });
  }
}
