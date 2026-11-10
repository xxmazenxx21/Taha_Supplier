import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { CreateCouponDto } from './dto/create-coupon.dto';
import { UpdateCouponDto } from './dto/update-coupon.dto';
import { PrismaService } from '../prisma/prisma.service';
import { Coupon, CouponStatus, Prisma } from '../../generated/prisma/client.js';

/** The columns the eligibility rules look at. */
export type CouponEligibilityFields = Pick<
  Coupon,
  | 'status'
  | 'start_date'
  | 'end_date'
  | 'usage_limit'
  | 'usage_count'
  | 'min_order_amount'
>;

@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single source of truth for "can this coupon be applied right now?".
   * Shared by the cart (preview) and checkout (enforced inside the
   * transaction). Pure: the caller performs the per-user usage lookup with
   * its own client and passes the result as `alreadyUsed`.
   *
   * @returns the first failing rule's message, or null when eligible.
   */
  getCouponIneligibilityReason(
    coupon: CouponEligibilityFields,
    subtotal: Prisma.Decimal,
    alreadyUsed: boolean,
    now: Date = new Date(),
  ): string | null {
    if (coupon.status !== CouponStatus.ACTIVE) {
      return 'Coupon is paused or inactive';
    }
    if (coupon.start_date && now < coupon.start_date) {
      return 'Coupon is not active yet';
    }
    if (coupon.end_date && now > coupon.end_date) {
      return 'Coupon has expired';
    }
    if (
      coupon.usage_limit !== null &&
      coupon.usage_count >= coupon.usage_limit
    ) {
      return 'Coupon usage limit reached';
    }
    if (
      coupon.min_order_amount !== null &&
      subtotal.lessThan(coupon.min_order_amount)
    ) {
      return `Minimum order amount of ${coupon.min_order_amount.toString()} not met`;
    }
    if (alreadyUsed) {
      return 'You have already used this coupon';
    }
    return null;
  }

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

    // Re-sending the coupon's own code is a no-op, not a conflict.
    if (
      updateCouponDto.code !== undefined &&
      updateCouponDto.code !== coupon.code
    ) {
      const duplicate = await this.prisma.coupon.findUnique({
        where: { code: updateCouponDto.code },
      });
      if (duplicate) {
        throw new ConflictException('Coupon already exists with this code');
      }
    }

    // Explicit mapping. `null` still clears the nullable columns.
    const data: Prisma.CouponUpdateInput = {};
    if (updateCouponDto.code !== undefined) data.code = updateCouponDto.code;
    if (updateCouponDto.discount_value !== undefined)
      data.discount_value = updateCouponDto.discount_value;
    if (updateCouponDto.min_order_amount !== undefined)
      data.min_order_amount = updateCouponDto.min_order_amount;
    if (updateCouponDto.usage_limit !== undefined)
      data.usage_limit = updateCouponDto.usage_limit;
    if (updateCouponDto.status !== undefined)
      data.status = updateCouponDto.status;
    if (updateCouponDto.start_date !== undefined)
      data.start_date = updateCouponDto.start_date
        ? new Date(updateCouponDto.start_date)
        : null;
    if (updateCouponDto.end_date !== undefined)
      data.end_date = updateCouponDto.end_date
        ? new Date(updateCouponDto.end_date)
        : null;

    try {
      return await this.prisma.coupon.update({ where: { id }, data });
    } catch (error) {
      // Race-condition safety net: another request took the code meanwhile.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Coupon already exists with this code');
      }
      throw error;
    }
  }
}
