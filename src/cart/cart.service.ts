import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

async findOrCreateByUserId(userId: number) {
  const cart = await this.prisma.cart.findUnique({
    where: { user_id: userId },
    include: { items: { include: { product: true } } },
  });
  if (cart) return cart;

  return this.prisma.cart.create({
    data: { user_id: userId },
    include: { items: { include: { product: true } } },
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

  /**
   * Return cart with product details and computed totals.
   * Uses `discount_price` when present, otherwise `price`.
   */
  async getCartWithTotals(userId: number) {
    const cart = await this.findOrCreateByUserId(userId);

    let total = 0;
    const items = cart.items.map((item) => {
      const product = item.product as any;
      const effective = product.discount_price ?? product.price;
      const effectiveNum = parseFloat(String(effective ?? 0));
      const lineTotal = effectiveNum * item.quantity;
      total += lineTotal;
      return {
        ...item,
        effective_price: effectiveNum,
        line_total: lineTotal,
      };
    });

    return {
      ...cart,
      items,
      total,
    };
  }





}
