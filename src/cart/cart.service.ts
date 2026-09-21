import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

async findOrCreateByUserId(userId: number) {
  const cart = await this.prisma.cart.findUnique({
    where: { user_id: userId },
    include: { items: { include: { product: true } }, coupon: true },
  });
  if (cart) return cart;

  return this.prisma.cart.create({
    data: { user_id: userId },
    include: { items: { include: { product: true } }, coupon: true },
  });
}

  async addItemToCart(userId: number, productId: number, quantity: number) {
    const cart = await this.findOrCreateByUserId(userId);

    // ensure product exists and is available
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.is_available) throw new ConflictException('Product is not available');

    // check if item already exists in cart
    const existing = await this.prisma.cartItem.findFirst({
      where: { cart_id: cart.id, product_id: productId },
    });

    if (existing) {
      // increment quantity
      if (!product.is_available) throw new ConflictException('Product is not available');
      return this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + quantity },
        include: { product: true },
      });
    }

    // create new cart item
    return this.prisma.cartItem.create({
      data: { cart_id: cart.id, product_id: productId, quantity },
      include: { product: true },
    });
  }

  async updateItem(userId: number, itemId: number, quantity: number) {
    const cart = await this.findOrCreateByUserId(userId);
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cart_id !== cart.id) throw new NotFoundException('Cart item not found');

    const product = await this.prisma.product.findUnique({ where: { id: item.product_id } });
    if (!product) throw new NotFoundException('Product not found');
    if (!product.is_available && quantity > 0) throw new ConflictException('Product is not available');

    if (quantity <= 0) {
      // remove the item
      await this.prisma.cartItem.delete({ where: { id: itemId } });
      return { deleted: true };
    }

    return this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity }, include: { product: true } });
  }

  async removeItem(userId: number, itemId: number) {
    const cart = await this.findOrCreateByUserId(userId);
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cart_id !== cart.id) throw new NotFoundException('Cart item not found');

    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  private async validateCouponLive(
    coupon: any,
    userId: number,
    subtotal: Prisma.Decimal,
  ): Promise<{ valid: boolean; reason: string | null }> {
    if (!coupon) return { valid: false, reason: 'Coupon not found' };

    if (coupon.status !== 'ACTIVE') {
      return { valid: false, reason: 'Coupon is paused or inactive' };
    }

    const now = new Date();
    if (coupon.start_date && now < coupon.start_date) {
      return { valid: false, reason: 'Coupon is not active yet' };
    }

    if (coupon.end_date && now > coupon.end_date) {
      return { valid: false, reason: 'Coupon has expired' };
    }

    if (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit) {
      return { valid: false, reason: 'Coupon usage limit reached' };
    }

    if (coupon.min_order_amount && subtotal.lessThan(coupon.min_order_amount)) {
      return {
        valid: false,
        reason: `Minimum order amount of ${coupon.min_order_amount.toString()} not met`,
      };
    }

    const usage = await this.prisma.couponUsage.findUnique({
      where: {
        coupon_id_user_id: {
          coupon_id: coupon.id,
          user_id: userId,
        },
      },
    });

    if (usage) {
      return { valid: false, reason: 'You have already used this coupon' };
    }

    return { valid: true, reason: null };
  }

  /**
   * Return cart with product details and computed totals.
   * Uses `discount_price` when present, otherwise `price`.
   */
  async getCartWithTotals(userId: number) {
    const cart = await this.findOrCreateByUserId(userId);

    let subtotalDecimal = new Prisma.Decimal(0);
    const items = cart.items.map((item) => {
      const product = item.product as any;
      const effective = product.discount_price ?? product.price;
      const effectiveDecimal = new Prisma.Decimal(effective ?? 0);
      const lineTotalDecimal = effectiveDecimal.mul(item.quantity);

      subtotalDecimal = subtotalDecimal.add(lineTotalDecimal);

      return {
        ...item,
        effective_price: Math.round(effectiveDecimal.toNumber()),
        line_total: Math.round(lineTotalDecimal.toNumber()),
      };
    });

    let discountAmountDecimal = new Prisma.Decimal(0);
    let totalDecimal = subtotalDecimal;
let couponValid: boolean | null = cart.coupon ? false : null;
    let couponInvalidReason: string | null = null;

    if (cart.coupon) {
      const validation = await this.validateCouponLive(
        cart.coupon,
        userId,
        subtotalDecimal,
      );
      couponValid = validation.valid;
      couponInvalidReason = validation.reason;

      if (couponValid) {
        const discountVal = new Prisma.Decimal(cart.coupon.discount_value ?? 0);
        discountAmountDecimal = subtotalDecimal.mul(discountVal.div(100));
        totalDecimal = subtotalDecimal.sub(discountAmountDecimal);
      }
    }

    return {
      ...cart,
      items,
      coupon_valid: couponValid,
      coupon_invalid_reason: couponInvalidReason,
      subtotal: Math.round(subtotalDecimal.toNumber()),
      discount_amount: Math.round(discountAmountDecimal.toNumber()),
      total: Math.round(totalDecimal.toNumber()),
    };
  }



  async applyCoupon(userId: number, code: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code },
    });

    if (!coupon) {
      throw new NotFoundException('Coupon not found');
    }

    // Calculate subtotal to check min_order_amount
    const cart = await this.findOrCreateByUserId(userId);
    let subtotalDecimal = new Prisma.Decimal(0);
    for (const item of cart.items) {
      const product = item.product as any;
      const effective = product.discount_price ?? product.price;
      subtotalDecimal = subtotalDecimal.add(
        new Prisma.Decimal(effective ?? 0).mul(item.quantity),
      );
    }

    const validation = await this.validateCouponLive(
      coupon,
      userId,
      subtotalDecimal,
    );

    if (!validation.valid) {
      throw new ConflictException(validation.reason);
    }

    // Update the cart with the coupon (replacing any existing coupon)
    await this.prisma.cart.update({
      where: { user_id: userId },
      data: { coupon_id: coupon.id },
    });

    // Return the updated cart totals
    return this.getCartWithTotals(userId);
  }











  async removeCoupon(userId: number) {
    const cart = await this.findOrCreateByUserId(userId);

    if (cart.coupon_id) {
      await this.prisma.cart.update({
        where: { user_id: userId },
        data: { coupon_id: null },
      });
    }

    return this.getCartWithTotals(userId);
  }
}
