import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CouponStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { CreateOrderDto } from './dto/create-order.dto';

const MAX_SERIALIZATION_RETRIES = 3;
const CLIENT_CANCELLATION_WINDOW_MS = 48 * 60 * 60 * 1000;

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async create(userId: number, dto: CreateOrderDto) {
    if (
      dto.payment_method === PaymentMethod.CARD &&
      !dto.payment_proof_image?.trim()
    ) {
      throw new BadRequestException(
        'payment_proof_image is required for card payments',
      );
    }

    for (let attempt = 0; attempt < MAX_SERIALIZATION_RETRIES; attempt += 1) {
      try {
        const order = await this.prisma.$transaction(
          async (tx) => {
            // Upsert also handles the first checkout for a user who has no cart yet.
            // The explicit row lock prevents a concurrent cart mutation from being
            // included in, or removed by, this checkout.
            const cartRow = await tx.cart.upsert({
              where: { user_id: userId },
              update: {},
              create: { user_id: userId },
              select: { id: true },
            });

            await tx.$queryRaw`
              SELECT "id"
              FROM "Cart"
              WHERE "id" = ${cartRow.id}
              FOR UPDATE
            `;

            await tx.$queryRaw`
              SELECT "id"
              FROM "CartItem"
              WHERE "cart_id" = ${cartRow.id}
              ORDER BY "id"
              FOR UPDATE
            `;

            const cart = await tx.cart.findUnique({
              where: { id: cartRow.id },
              include: {
                items: {
                  include: { product: { include: { subCategory: true } } },
                },
              },
            });

            if (!cart || cart.items.length === 0) {
              throw new ConflictException('Cart is empty');
            }

            if (cart.items.some((item) => item.quantity <= 0)) {
              throw new ConflictException('Cart contains an invalid quantity');
            }

            const productIds = [
              ...new Set(cart.items.map((item) => item.product_id)),
            ].sort((a, b) => a - b);

            await tx.$queryRaw`
              SELECT "id"
              FROM "Product"
              WHERE "id" IN (${Prisma.join(productIds)})
              ORDER BY "id"
              FOR UPDATE
            `;

            // Re-read after acquiring product locks so all product snapshots are
            // taken from the same transaction state used for the order.
            const freshCart = await tx.cart.findUnique({
              where: { id: cartRow.id },
              include: {
                items: {
                  include: { product: { include: { subCategory: true } } },
                },
              },
            });

            if (!freshCart || freshCart.items.length === 0) {
              throw new ConflictException('Cart is empty');
            }

            for (const item of freshCart.items) {
              if (
                !item.product.is_available ||
                item.product.subCategory.is_hidden
              ) {
                throw new ConflictException(
                  `Product "${item.product.name}" is not available`,
                );
              }
            }

            let subtotal = new Prisma.Decimal(0);
            const orderItems = freshCart.items.map((item) => {
              const unitPrice = new Prisma.Decimal(
                item.product.discount_price ?? item.product.price,
              );
              const totalPrice = unitPrice.mul(item.quantity);
              subtotal = subtotal.add(totalPrice);

              return {
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: unitPrice,
                total_price: totalPrice,
                product_name: item.product.name,
                product_unit: item.product.unit,
              };
            });

            await tx.$queryRaw`
              SELECT "id"
              FROM "ShippingZone"
              WHERE "id" = ${dto.shipping_zone_id}
              FOR UPDATE
            `;

            const shippingZone = await tx.shippingZone.findUnique({
              where: { id: dto.shipping_zone_id },
            });

            if (!shippingZone || !shippingZone.is_active) {
              throw new ConflictException(
                'Shipping zone does not exist or is inactive',
              );
            }

            const shippingFee = new Prisma.Decimal(shippingZone.shipping_cost);
            let discountAmount = new Prisma.Decimal(0);
            let couponId: number | null = null;
            let coupon: Awaited<ReturnType<typeof tx.coupon.findUnique>> = null;

            if (freshCart.coupon_id !== null) {
              coupon = await tx.coupon.findUnique({
                where: { id: freshCart.coupon_id },
              });

              if (!coupon) {
                throw new ConflictException('Coupon is no longer available');
              }

              const now = new Date();
              if (coupon.status !== CouponStatus.ACTIVE) {
                throw new ConflictException('Coupon is paused or inactive');
              }
              if (coupon.start_date && now < coupon.start_date) {
                throw new ConflictException('Coupon is not active yet');
              }
              if (coupon.end_date && now > coupon.end_date) {
                throw new ConflictException('Coupon has expired');
              }
              if (
                coupon.usage_limit !== null &&
                coupon.usage_count >= coupon.usage_limit
              ) {
                throw new ConflictException('Coupon usage limit reached');
              }
              if (
                coupon.min_order_amount !== null &&
                subtotal.lessThan(coupon.min_order_amount)
              ) {
                throw new ConflictException(
                  `Minimum order amount of ${coupon.min_order_amount.toString()} not met`,
                );
              }

              const existingUsage = await tx.couponUsage.findUnique({
                where: {
                  coupon_id_user_id: {
                    coupon_id: coupon.id,
                    user_id: userId,
                  },
                },
              });

              if (existingUsage) {
                throw new ConflictException(
                  'You have already used this coupon',
                );
              }

              // Prisma cannot express a comparison between two columns in a
              // normal updateMany filter, so keep this conditional update
              // parameterized and inside the same transaction.
              const consumed = await tx.$executeRaw`
                UPDATE "Coupon"
                SET "usage_count" = "usage_count" + 1
                WHERE "id" = ${coupon.id}
                  AND (
                    "usage_limit" IS NULL
                    OR "usage_count" < "usage_limit"
                  )
              `;

              if (consumed !== 1) {
                throw new ConflictException(
                  'Coupon usage limit was reached during checkout',
                );
              }

              couponId = coupon.id;
              discountAmount = subtotal.mul(
                new Prisma.Decimal(coupon.discount_value).div(100),
              );
            }

            const totalAmount = subtotal.sub(discountAmount).add(shippingFee);

            const order = await tx.order.create({
              data: {
                user_id: userId,
                coupon_id: couponId,
                shipping_zone_id: shippingZone.id,
                payment_method: dto.payment_method,
                payment_proof_image:
                  dto.payment_method === PaymentMethod.CARD
                    ? dto.payment_proof_image
                    : null,
                subtotal,
                discount_amount: discountAmount,
                shipping_fee: shippingFee,
                total_amount: totalAmount,
                delivery_address: dto.delivery_address,
                delivery_lat: dto.delivery_lat,
                delivery_lng: dto.delivery_lng,
                delivery_notes: dto.delivery_notes,
                items: { create: orderItems },
              },
              include: { items: true },
            });

            if (couponId !== null) {
              try {
                // Coupon usage is permanent after a successfully committed
                // order. A future cancellation flow must not restore it
                // unless the business policy is explicitly changed.
                await tx.couponUsage.create({
                  data: {
                    coupon_id: couponId,
                    user_id: userId,
                    order_id: order.id,
                  },
                });
              } catch (error) {
                if (
                  error instanceof Prisma.PrismaClientKnownRequestError &&
                  error.code === 'P2002'
                ) {
                  throw new ConflictException(
                    'You have already used this coupon',
                  );
                }
                throw error;
              }
            }

            await tx.cartItem.deleteMany({
              where: { cart_id: freshCart.id },
            });
            await tx.cart.update({
              where: { id: freshCart.id },
              data: { coupon_id: null },
            });

            return order;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            maxWait: 5000,
            timeout: 10000,
          },
        );

        const devices = await this.prisma.userDevice.findMany({
          where: { user_id: userId },
          select: { token: true },
        });

        await this.notificationService.sendOrderCreatedNotification(
          devices.map((device) => device.token),
          order.id,
        );

        return this.formatOrderResponse(order);
      } catch (error) {
        if (
          this.isSerializationFailure(error) &&
          attempt < MAX_SERIALIZATION_RETRIES - 1
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException(
      'Checkout could not be completed because the cart changed concurrently',
    );
  }

  async findMyOrders(userId: number) {
    const orders = await this.prisma.order.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      include: {
        items: true,
        shippingZone: true,
      },
    });

    return orders.map((order) => this.formatOrderResponse(order));
  }

  async findMyOrder(userId: number, orderId: number) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, user_id: userId },
      include: {
        items: true,
        shippingZone: true,
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.formatOrderResponse(order);
  }

  async findAllOrders() {
    const orders = await this.prisma.order.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        items: true,
        shippingZone: true,
        user: {
          select: {
            id: true,
            name: true,
            shop_name: true,
            phone: true,
            email: true,
            address: true,
          },
        },
      },
    });

    return orders.map((order) => this.formatOrderResponse(order));
  }

  async findCancelledOrders() {
    const orders = await this.prisma.order.findMany({
      where: {
        status: {
          in: [OrderStatus.CANCELLED, OrderStatus.CLIENTCANCELLED],
        },
      },
      orderBy: { created_at: 'desc' },
      include: {
        items: true,
        shippingZone: true,
        user: {
          select: {
            id: true,
            name: true,
            shop_name: true,
            phone: true,
            email: true,
            address: true,
          },
        },
      },
    });

    return orders.map((order) => this.formatOrderResponse(order));
  }

  async cancel(userId: number, orderId: number) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, user_id: true, status: true, created_at: true },
    });

    if (!order || order.user_id !== userId) {
      throw new NotFoundException('Order not found');
    }

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.CLIENTCANCELLED
    ) {
      throw new ConflictException('Order is already cancelled');
    }

    if (
      Date.now() - order.created_at.getTime() >
      CLIENT_CANCELLATION_WINDOW_MS
    ) {
      throw new ConflictException(
        'Orders can only be cancelled within 48 hours of creation',
      );
    }

    const cancelledOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CLIENTCANCELLED },
      include: {
        items: true,
        shippingZone: true,
      },
    });

    return this.formatOrderResponse(cancelledOrder);
  }

  async updateStatus(orderId: number, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, user_id: true },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const updatedOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status },
      include: {
        items: true,
        shippingZone: true,
        user: {
          select: {
            id: true,
            name: true,
            shop_name: true,
            phone: true,
            email: true,
            address: true,
          },
        },
      },
    });

    const devices = await this.prisma.userDevice.findMany({
      where: { user_id: order.user_id },
      select: { token: true },
    });

    await this.notificationService.sendOrderStatusChangedNotification(
      devices.map((device) => device.token),
      updatedOrder.id,
      updatedOrder.status,
    );

    return this.formatOrderResponse(updatedOrder);
  }

  private isSerializationFailure(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private formatOrderResponse(order: {
    subtotal: Prisma.Decimal;
    discount_amount: Prisma.Decimal;
    shipping_fee: Prisma.Decimal;
    total_amount: Prisma.Decimal;
    items: Array<{
      unit_price: Prisma.Decimal;
      total_price: Prisma.Decimal;
      [key: string]: unknown;
    }>;
    shippingZone?: {
      shipping_cost: Prisma.Decimal;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }) {
    return {
      ...order,
      subtotal: Math.round(order.subtotal.toNumber()),
      discount_amount: Math.round(order.discount_amount.toNumber()),
      shipping_fee: Math.round(order.shipping_fee.toNumber()),
      total_amount: Math.round(order.total_amount.toNumber()),
      items: order.items.map((item) => ({
        ...item,
        unit_price: Math.round(item.unit_price.toNumber()),
        total_price: Math.round(item.total_price.toNumber()),
      })),
      shippingZone: order.shippingZone
        ? {
            ...order.shippingZone,
            shipping_cost: Math.round(
              order.shippingZone.shipping_cost.toNumber(),
            ),
          }
        : undefined,
    };
  }
}
