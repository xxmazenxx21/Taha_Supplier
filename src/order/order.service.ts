import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { runSerializableTransaction } from '../prisma/serializable-transaction';
import { CouponService } from '../coupon/coupon.service';
import { NotificationService } from '../notification/notification.service';
import { getErrorMessage } from '../utils/error-message';
import { deletePrivateFile } from '../utils/multer/private-files';
import { CreateOrderDto } from './dto/create-order.dto';
import { formatOrderResponse } from './order.mapper';

const MAX_SERIALIZATION_RETRIES = 3;
const CLIENT_CANCELLATION_WINDOW_MS = 48 * 60 * 60 * 1000;
const CLIENT_CANCELLABLE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
];

const checkoutCartInclude = {
  items: { include: { product: { include: { subCategory: true } } } },
} satisfies Prisma.CartInclude;

type CheckoutCart = Prisma.CartGetPayload<{
  include: typeof checkoutCartInclude;
}>;
type CheckoutShippingZone = Prisma.ShippingZoneGetPayload<object>;
type CheckoutOrderItem = Prisma.OrderItemUncheckedCreateWithoutOrderInput;
type CreatedOrder = Prisma.OrderGetPayload<{ include: { items: true } }>;

/** Client side of the order module: checkout and the customer's own orders. */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly couponService: CouponService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * @param paymentProofPath relative path of an already-uploaded receipt, or
   * undefined. Deleted from disk if anything below fails.
   */
  async create(userId: number, dto: CreateOrderDto, paymentProofPath?: string) {
    // Validate the method/file combination before any transaction work starts.
    if (dto.payment_method === PaymentMethod.CARD && !paymentProofPath) {
      throw new BadRequestException(
        'payment_proof is required for card payments',
      );
    }

    if (dto.payment_method === PaymentMethod.CASH && paymentProofPath) {
      await deletePrivateFile(paymentProofPath, this.logger);
      throw new BadRequestException(
        'payment_proof is only accepted for card payments',
      );
    }

    let order: CreatedOrder;
    try {
      order = await this.runCheckout(userId, dto, paymentProofPath);
    } catch (error) {
      // Covers validation, conflicts, and exhausted serialization retries.
      if (paymentProofPath) {
        await deletePrivateFile(paymentProofPath, this.logger);
      }
      throw error;
    }

    // The order is committed from here on — a push failure must not fail it.
    try {
      const devices = await this.prisma.userDevice.findMany({
        where: { user_id: userId },
        select: { token: true },
      });

      await this.notificationService.sendOrderCreatedNotification(
        devices.map((device) => device.token),
        order.id,
      );
    } catch (error) {
      this.logger.error(
        `Failed to send order-created notification for order ${order.id}: ${getErrorMessage(error)}`,
      );
    }

    return formatOrderResponse(order);
  }

  // ───────────────────────── checkout ─────────────────────────

  private runCheckout(
    userId: number,
    dto: CreateOrderDto,
    paymentProofPath?: string,
  ): Promise<CreatedOrder> {
    return runSerializableTransaction(
      this.prisma,
      (tx) => this.checkout(tx, userId, dto, paymentProofPath),
      { maxRetries: MAX_SERIALIZATION_RETRIES, maxWait: 5000, timeout: 10000 },
      () =>
        new ConflictException(
          'Checkout could not be completed because the cart changed concurrently',
        ),
    );
  }

  /**
   * One checkout attempt. Lock order matters for serializable correctness:
   * cart → cart items → products → shipping zone → coupon.
   */
  private async checkout(
    tx: Prisma.TransactionClient,
    userId: number,
    dto: CreateOrderDto,
    paymentProofPath?: string,
  ): Promise<CreatedOrder> {
    const cart = await this.lockAndLoadCart(tx, userId);
    this.assertItemsAvailable(cart);
    const { orderItems, subtotal } = this.buildOrderItems(cart);

    const shippingZone = await this.lockActiveShippingZone(
      tx,
      dto.shipping_zone_id,
    );
    const shippingFee = new Prisma.Decimal(shippingZone.shipping_cost);

    const { couponId, discountAmount } = await this.consumeCoupon(
      tx,
      cart.coupon_id,
      userId,
      subtotal,
    );

    const order = await this.createOrderRecord(tx, {
      userId,
      dto,
      paymentProofPath,
      shippingZoneId: shippingZone.id,
      couponId,
      orderItems,
      subtotal,
      discountAmount,
      shippingFee,
    });

    if (couponId !== null) {
      await this.recordCouponUsage(tx, couponId, userId, order.id);
    }

    await this.clearCart(tx, cart.id);

    return order;
  }

  /**
   * Steps 1-5: lock the cart row, its items and every product in it, then
   * re-read the cart so all product snapshots come from the locked state.
   */
  private async lockAndLoadCart(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<CheckoutCart> {
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
      include: checkoutCartInclude,
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
      include: checkoutCartInclude,
    });

    if (!freshCart || freshCart.items.length === 0) {
      throw new ConflictException('Cart is empty');
    }

    return freshCart;
  }

  /** Step 6. */
  private assertItemsAvailable(cart: CheckoutCart): void {
    for (const item of cart.items) {
      if (!item.product.is_available || item.product.subCategory.is_hidden) {
        throw new ConflictException(
          `Product "${item.product.name}" is not available`,
        );
      }
    }
  }

  /** Step 7: snapshot prices and names; unit price prefers discount_price. */
  private buildOrderItems(cart: CheckoutCart): {
    orderItems: CheckoutOrderItem[];
    subtotal: Prisma.Decimal;
  } {
    let subtotal = new Prisma.Decimal(0);
    const orderItems = cart.items.map((item): CheckoutOrderItem => {
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

    return { orderItems, subtotal };
  }

  /** Step 8. */
  private async lockActiveShippingZone(
    tx: Prisma.TransactionClient,
    shippingZoneId: number,
  ): Promise<CheckoutShippingZone> {
    await tx.$queryRaw`
      SELECT "id"
      FROM "ShippingZone"
      WHERE "id" = ${shippingZoneId}
      FOR UPDATE
    `;

    const shippingZone = await tx.shippingZone.findUnique({
      where: { id: shippingZoneId },
    });

    if (!shippingZone || !shippingZone.is_active) {
      throw new ConflictException(
        'Shipping zone does not exist or is inactive',
      );
    }

    return shippingZone;
  }

  /**
   * Step 9: re-validate the coupon on the cart, then atomically take one
   * usage. Returns a zero discount when the cart has no coupon.
   */
  private async consumeCoupon(
    tx: Prisma.TransactionClient,
    cartCouponId: number | null,
    userId: number,
    subtotal: Prisma.Decimal,
  ): Promise<{ couponId: number | null; discountAmount: Prisma.Decimal }> {
    if (cartCouponId === null) {
      return { couponId: null, discountAmount: new Prisma.Decimal(0) };
    }

    const coupon = await tx.coupon.findUnique({ where: { id: cartCouponId } });

    if (!coupon) {
      throw new ConflictException('Coupon is no longer available');
    }

    const existingUsage = await tx.couponUsage.findUnique({
      where: {
        coupon_id_user_id: { coupon_id: coupon.id, user_id: userId },
      },
    });

    const ineligibilityReason = this.couponService.getCouponIneligibilityReason(
      coupon,
      subtotal,
      existingUsage !== null,
    );
    if (ineligibilityReason) {
      throw new ConflictException(ineligibilityReason);
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

    return {
      couponId: coupon.id,
      discountAmount: subtotal.mul(
        new Prisma.Decimal(coupon.discount_value).div(100),
      ),
    };
  }

  /** Step 10. */
  private createOrderRecord(
    tx: Prisma.TransactionClient,
    input: {
      userId: number;
      dto: CreateOrderDto;
      paymentProofPath?: string;
      shippingZoneId: number;
      couponId: number | null;
      orderItems: CheckoutOrderItem[];
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      shippingFee: Prisma.Decimal;
    },
  ): Promise<CreatedOrder> {
    const { dto, subtotal, discountAmount, shippingFee } = input;
    const totalAmount = subtotal.sub(discountAmount).add(shippingFee);

    return tx.order.create({
      data: {
        user_id: input.userId,
        coupon_id: input.couponId,
        shipping_zone_id: input.shippingZoneId,
        payment_method: dto.payment_method,
        payment_proof_image:
          dto.payment_method === PaymentMethod.CARD
            ? input.paymentProofPath
            : null,
        subtotal,
        discount_amount: discountAmount,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        delivery_address: dto.delivery_address,
        delivery_lat: dto.delivery_lat,
        delivery_lng: dto.delivery_lng,
        delivery_notes: dto.delivery_notes,
        items: { create: input.orderItems },
      },
      include: { items: true },
    });
  }

  /**
   * Step 11. Coupon usage is permanent after a successfully committed order.
   * A future cancellation flow must not restore it unless the business policy
   * is explicitly changed.
   */
  private async recordCouponUsage(
    tx: Prisma.TransactionClient,
    couponId: number,
    userId: number,
    orderId: number,
  ): Promise<void> {
    try {
      await tx.couponUsage.create({
        data: { coupon_id: couponId, user_id: userId, order_id: orderId },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already used this coupon');
      }
      throw error;
    }
  }

  /** Step 12. */
  private async clearCart(
    tx: Prisma.TransactionClient,
    cartId: number,
  ): Promise<void> {
    await tx.cartItem.deleteMany({ where: { cart_id: cartId } });
    await tx.cart.update({ where: { id: cartId }, data: { coupon_id: null } });
  }

  // ───────────────────────── my orders ─────────────────────────

  async findMyOrders(userId: number) {
    const orders = await this.prisma.order.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      include: {
        items: true,
        shippingZone: true,
      },
    });

    return orders.map((order) => formatOrderResponse(order));
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

    return formatOrderResponse(order);
  }

  /**
   * Client re-uploads a receipt after an admin rejection.
   * @param paymentProofPath relative path of the newly uploaded file.
   */
  async replacePaymentProof(
    userId: number,
    orderId: number,
    paymentProofPath: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        user_id: true,
        status: true,
        payment_method: true,
        payment_status: true,
        payment_proof_image: true,
      },
    });

    if (!order || order.user_id !== userId) {
      await deletePrivateFile(paymentProofPath, this.logger);
      throw new NotFoundException('Order not found');
    }

    if (order.payment_method !== PaymentMethod.CARD) {
      await deletePrivateFile(paymentProofPath, this.logger);
      throw new ConflictException('Only card orders accept a payment proof');
    }

    if (
      order.status === OrderStatus.CANCELLED ||
      order.status === OrderStatus.CLIENTCANCELLED
    ) {
      await deletePrivateFile(paymentProofPath, this.logger);
      throw new ConflictException(
        'A cancelled order cannot accept a new payment proof',
      );
    }

    if (order.payment_status !== PaymentStatus.REJECTED) {
      await deletePrivateFile(paymentProofPath, this.logger);
      throw new ConflictException(
        'A new payment proof can only be uploaded after the previous one was rejected',
      );
    }

    const updatedOrder = await this.prisma.order
      .update({
        where: { id: orderId },
        data: {
          payment_proof_image: paymentProofPath,
          payment_status: PaymentStatus.PENDING,
        },
        include: { items: true, shippingZone: true },
      })
      .catch(async (error: unknown) => {
        await deletePrivateFile(paymentProofPath, this.logger);
        throw error;
      });

    // Only once the new path is committed is the old file safe to remove.
    if (order.payment_proof_image) {
      await deletePrivateFile(order.payment_proof_image, this.logger);
    }

    return formatOrderResponse(updatedOrder);
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

    if (!CLIENT_CANCELLABLE_STATUSES.includes(order.status)) {
      throw new ConflictException('Order can no longer be cancelled');
    }

    const cancelledOrder = await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CLIENTCANCELLED },
      include: {
        items: true,
        shippingZone: true,
      },
    });

    return formatOrderResponse(cancelledOrder);
  }
}
